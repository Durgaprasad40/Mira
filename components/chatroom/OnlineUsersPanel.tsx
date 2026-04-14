import React, { useEffect, useRef, useMemo, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Pressable,
  Animated,
  StyleSheet,
  useWindowDimensions,
  Image,
  SectionList,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { INCOGNITO_COLORS } from '@/lib/constants';
import { DemoOnlineUser } from '@/lib/demoData';
// P2-001/002/003/P3-005: Import responsive utilities
import {
  CHAT_FONTS,
  CHAT_SIZES,
  SPACING,
  AVATAR_BORDERS,
  GENDER_COLORS,
} from '@/lib/responsive';

const C = INCOGNITO_COLORS;

// Time constants for online/offline grouping (legacy fallback)
const GRACE_PERIOD_MS = 2 * 60 * 1000; // 2 minutes grace
const OFFLINE_MAX_AGE_MS = 3 * 60 * 60 * 1000; // 3 hours max

function formatLastSeen(timestamp?: number): string {
  if (!timestamp) return 'Last seen a while ago';
  const diff = Date.now() - timestamp;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Last seen just now';
  if (mins < 60) return `Last seen ${mins} min${mins > 1 ? 's' : ''} ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `Last seen ${hours} hour${hours > 1 ? 's' : ''} ago`;
  const days = Math.floor(hours / 24);
  return `Last seen ${days} day${days > 1 ? 's' : ''} ago`;
}

// Phase-2: Extended user type with optional penalty
interface OnlineUserWithPenalty extends DemoOnlineUser {
  penalty?: { type: 'readOnly'; expiresAt: number } | null;
}

// Room-specific presence user (presence truth enriched locally in the room screen)
interface PresenceUser {
  id: string;
  displayName: string;
  avatar?: string;
  age?: number;
  gender?: 'male' | 'female' | 'other' | '';
  bio?: string;
  role: 'owner' | 'admin' | 'member';
  lastHeartbeatAt: number;
  joinedAt: number;
}

interface OnlineUsersPanelProps {
  visible: boolean;
  onClose: () => void;
  /** Legacy: users array (for demo mode fallback) */
  users?: OnlineUserWithPenalty[];
  /** Room-specific presence: online users */
  presenceOnline?: PresenceUser[];
  /** Room-specific presence: recently left users */
  presenceRecentlyLeft?: PresenceUser[];
  onUserPress?: (user: OnlineUserWithPenalty | PresenceUser) => void;
}

// Unified user type for rendering (supports both legacy and presence modes)
type UnifiedUser = {
  id: string;
  displayName: string;
  avatar?: string;
  age?: number;
  gender?: 'male' | 'female' | 'other' | '';
  isOnline: boolean;
  lastHeartbeatAt?: number;
  role?: 'owner' | 'admin' | 'member';
  penalty?: { type: 'readOnly'; expiresAt: number } | null;
};

type SectionData = {
  title: string;
  data: UnifiedUser[];
};

// Helper: Get display name for sorting (null-safe)
function getDisplayName(user: UnifiedUser): string {
  return (user.displayName || user.id || '').toLowerCase();
}

// LIST-STABILITY-FIX: Stable sort comparator using alphabetical order + userId as tiebreaker
// Defined outside component to prevent recreation on each render
function stableSortComparator(a: UnifiedUser, b: UnifiedUser): number {
  // Primary: normalized display name alphabetical (case-insensitive)
  const nameA = (a.displayName || '').toLowerCase();
  const nameB = (b.displayName || '').toLowerCase();
  const nameCompare = nameA.localeCompare(nameB);
  if (nameCompare !== 0) return nameCompare;

  // Secondary: exact display name for same-when-lowercased names
  const exactCompare = (a.displayName || '').localeCompare(b.displayName || '');
  if (exactCompare !== 0) return exactCompare;

  // Tertiary: stable tiebreaker using canonical userId (immutable)
  return (a.id || '').localeCompare(b.id || '');
}

export default function OnlineUsersPanel({
  visible,
  onClose,
  users,
  presenceOnline,
  presenceRecentlyLeft,
  onUserPress,
}: OnlineUsersPanelProps) {
  // P1-010 FIX: Use reactive window dimensions instead of static Dimensions.get()
  const { width: windowWidth } = useWindowDimensions();
  const panelWidth = windowWidth * 0.78;

  const translateX = useRef(new Animated.Value(windowWidth)).current;

  // Determine if we're using presence-based data
  const usePresenceMode = !!presenceOnline || !!presenceRecentlyLeft;

  // P1-010 FIX: Use reactive windowWidth for animation
  useEffect(() => {
    Animated.spring(translateX, {
      toValue: visible ? 0 : windowWidth,
      useNativeDriver: true,
      tension: 65,
      friction: 11,
    }).start();
  }, [visible, windowWidth, translateX]);

  const sections = useMemo((): SectionData[] => {
    // Presence mode: use pre-categorized data
    if (usePresenceMode) {
      const result: SectionData[] = [];

      // CHATROOM_PRESENCE_STATE: Log presence state
      console.log('CHATROOM_PRESENCE_STATE', {
        onlineCount: presenceOnline?.length ?? 0,
        recentlyLeftCount: presenceRecentlyLeft?.length ?? 0,
      });

      if (presenceOnline && presenceOnline.length > 0) {
        const online: UnifiedUser[] = presenceOnline.map((u) => ({
          id: u.id,
          displayName: u.displayName,
          avatar: u.avatar,
          age: u.age,
          gender: u.gender || undefined,
          isOnline: true, // CHATROOM_PRESENCE_FIX: Online users show green dot, NO lastSeen
          lastHeartbeatAt: u.lastHeartbeatAt,
          role: u.role,
        }));
        // LIST-STABILITY-FIX: Sort alphabetically by display name, with stable tiebreaker
        online.sort(stableSortComparator);

        result.push({ title: 'Online', data: online });
      }

      if (presenceRecentlyLeft && presenceRecentlyLeft.length > 0) {
        const recentlyLeft: UnifiedUser[] = presenceRecentlyLeft.map((u) => ({
          id: u.id,
          displayName: u.displayName,
          avatar: u.avatar,
          age: u.age,
          gender: u.gender || undefined,
          isOnline: false, // CHATROOM_PRESENCE_FIX: Recently left users show lastSeen, NO green dot
          lastHeartbeatAt: u.lastHeartbeatAt,
          role: u.role,
        }));
        // LIST-STABILITY-FIX: Sort alphabetically by display name, with stable tiebreaker
        recentlyLeft.sort(stableSortComparator);
        result.push({ title: 'Recently Left', data: recentlyLeft });
      }

      return result;
    }

    // Legacy mode: compute from users array (for demo mode)
    if (!users) return [];
    const now = Date.now();

    // Online: currently online OR last seen within grace period
    const online = users
      .filter((u) => {
        if (u.isOnline) return true;
        if (u.lastSeen && now - u.lastSeen <= GRACE_PERIOD_MS) return true;
        return false;
      })
      .map((u): UnifiedUser => ({
        id: u.id,
        displayName: u.username || u.id || 'Unknown',
        avatar: u.avatar,
        age: u.age,
        gender: u.gender,
        isOnline: true,
        lastHeartbeatAt: u.lastSeen,
        penalty: u.penalty,
      }));
    // LIST-STABILITY-FIX: Use stable sort instead of volatile lastSeen
    online.sort(stableSortComparator);

    // Offline: not online, outside grace period, but within max age
    const offline = users
      .filter((u) => {
        if (u.isOnline) return false;
        if (u.lastSeen && now - u.lastSeen <= GRACE_PERIOD_MS) return false;
        if (!u.lastSeen) return false;
        return now - u.lastSeen <= OFFLINE_MAX_AGE_MS;
      })
      .map((u): UnifiedUser => ({
        id: u.id,
        displayName: u.username || u.id || 'Unknown',
        avatar: u.avatar,
        age: u.age,
        gender: u.gender,
        isOnline: false,
        lastHeartbeatAt: u.lastSeen,
        penalty: u.penalty,
      }));
    // LIST-STABILITY-FIX: Use stable sort instead of volatile lastSeen
    offline.sort(stableSortComparator);

    const result: SectionData[] = [];
    if (online.length > 0) result.push({ title: 'Online', data: online });
    if (offline.length > 0) result.push({ title: 'Offline', data: offline });
    return result;
  }, [users, presenceOnline, presenceRecentlyLeft, usePresenceMode]);

  // Count for badge (presence mode uses presenceOnline, legacy computes from users)
  const onlineCount = useMemo(() => {
    if (usePresenceMode) {
      return presenceOnline?.length ?? 0;
    }
    if (!users) return 0;
    const now = Date.now();
    return users.filter((u) => {
      if (u.isOnline) return true;
      if (u.lastSeen && now - u.lastSeen <= GRACE_PERIOD_MS) return true;
      return false;
    }).length;
  }, [users, presenceOnline, usePresenceMode]);

  const renderUser = useCallback(({ item }: { item: UnifiedUser }) => {
    // Get gender-based ring color
    const ringColor = GENDER_COLORS[item.gender || 'default'] || GENDER_COLORS.default;

    // CHATROOM_IDENTITY_FIX: Age shown as inline plain text "name, age"
    // NO badge/chip per rules 11-13
    const displayWithAge = item.age && item.age > 0
      ? `${item.displayName}, ${item.age}`
      : item.displayName;

    // CHATROOM_USERS_PANEL_RENDER: Log what's being rendered
    console.log('CHATROOM_USERS_PANEL_RENDER', {
      userId: item.id.slice(0, 12),
      displayName: item.displayName,
      age: item.age,
      isOnline: item.isOnline,
      hasAvatar: !!item.avatar,
    });

    return (
      <Pressable
        style={({ pressed }) => [styles.userRow, pressed && { opacity: 0.7 }]}
        onPress={(e) => {
          e.stopPropagation?.();
          // Convert UnifiedUser back to a compatible format for onUserPress
          onUserPress?.({
            id: item.id,
            username: item.displayName,
            avatar: item.avatar,
            isOnline: item.isOnline,
            age: item.age,
            gender: item.gender as 'male' | 'female' | undefined,
            lastSeen: item.lastHeartbeatAt,
          } as any);
        }}
        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
      >
        {/* Avatar with gender ring - NO green online dot (section title shows status) */}
        {item.avatar ? (
          <View style={styles.avatarContainer}>
            <Image
              source={{ uri: item.avatar }}
              style={[styles.userAvatar, { borderColor: ringColor }]}
            />
          </View>
        ) : (
          <View style={styles.avatarContainer}>
            <View style={[styles.userAvatarPlaceholder, { borderColor: ringColor }]}>
              <Ionicons name="person" size={14} color={C.textLight} />
            </View>
          </View>
        )}
        <View style={styles.userInfo}>
          {/* CHATROOM_IDENTITY_FIX: Age as plain inline text "name, age" - NO badge */}
          <Text style={styles.userName} numberOfLines={1}>{displayWithAge}</Text>
          {/* CHATROOM_PRESENCE_FIX: Only show lastSeen if user is NOT online (in Recently Left section) */}
          {!item.isOnline && item.lastHeartbeatAt && (
            <Text style={styles.lastSeen}>{formatLastSeen(item.lastHeartbeatAt)}</Text>
          )}
        </View>
        {/* Show role badge for owner/admin */}
        {item.role === 'owner' && (
          <View style={styles.roleBadge}>
            <Text style={styles.roleBadgeText}>Owner</Text>
          </View>
        )}
        {item.role === 'admin' && (
          <View style={[styles.roleBadge, styles.adminBadge]}>
            <Text style={styles.roleBadgeText}>Admin</Text>
          </View>
        )}
        {/* Phase-2: Show Read-only badge if user has penalty */}
        {item.penalty ? (
          <View style={styles.readOnlyBadge}>
            <Text style={styles.readOnlyBadgeText}>Read-only</Text>
          </View>
        ) : null}
      </Pressable>
    );
  }, [onUserPress]);

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
      {/* P1-010 FIX: Use dynamic width from useWindowDimensions */}
      <Animated.View
        style={[styles.panel, { width: panelWidth, transform: [{ translateX }] }]}
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
        {/* P1-011 FIX: Added virtualization optimizations */}
        <SectionList
          sections={sections}
          keyExtractor={(item) => item.id}
          renderItem={renderUser}
          renderSectionHeader={renderSectionHeader}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.listContent}
          stickySectionHeadersEnabled={false}
          initialNumToRender={15}
          maxToRenderPerBatch={10}
          updateCellsBatchingPeriod={50}
          windowSize={5}
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <Ionicons name="people-outline" size={36} color={C.textLight} />
              <Text style={styles.emptyText}>No users online</Text>
            </View>
          }
        />
      </Animated.View>
    </View>
  );
}

// P2-001/002/003: Responsive avatar size for panel
const PANEL_AVATAR = CHAT_SIZES.panelAvatar;

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
    // P1-010 FIX: Width is now set dynamically via inline style
    backgroundColor: C.surface,
    borderLeftWidth: 1,
    borderLeftColor: C.accent,
    paddingTop: 50,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    // P2-002: Use SPACING constants
    paddingHorizontal: SPACING.base,
    paddingBottom: SPACING.sm + 2,
    borderBottomWidth: 1,
    borderBottomColor: C.accent,
  },
  headerTitle: {
    // P2-001: Use responsive typography
    fontSize: CHAT_FONTS.panelTitle,
    fontWeight: '700',
    color: C.text,
  },
  closeIcon: {
    padding: SPACING.xs,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    // P2-002: Use SPACING constants
    paddingHorizontal: SPACING.base,
    paddingTop: SPACING.sm + 2,
    paddingBottom: SPACING.xs,
    gap: SPACING.xs + 2,
  },
  sectionTitle: {
    // P2-001: Use responsive typography
    fontSize: CHAT_FONTS.sectionHeader,
    fontWeight: '700',
    color: C.textLight,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  onlineCountBadge: {
    backgroundColor: '#00B894',
    borderRadius: SPACING.sm,
    paddingHorizontal: SPACING.xs + 2,
    paddingVertical: 1,
  },
  onlineCountText: {
    // P2-001: Use responsive typography
    fontSize: CHAT_FONTS.secondary,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  listContent: {
    paddingBottom: SPACING.xxl + SPACING.sm,
  },
  userRow: {
    flexDirection: 'row',
    alignItems: 'center',
    // P2-002: Use SPACING constants
    paddingHorizontal: SPACING.base,
    paddingVertical: SPACING.sm,
    gap: SPACING.sm + 2,
  },
  avatarContainer: {
    position: 'relative',
  },
  userAvatar: {
    // P2-003: Use responsive avatar size and standardized border
    width: PANEL_AVATAR,
    height: PANEL_AVATAR,
    borderRadius: PANEL_AVATAR / 2,
    borderWidth: AVATAR_BORDERS.standard,
    borderColor: '#9CA3AF', // Default, overridden by gender color
  },
  userAvatarPlaceholder: {
    // P2-003: Use responsive avatar size and standardized border
    width: PANEL_AVATAR,
    height: PANEL_AVATAR,
    borderRadius: PANEL_AVATAR / 2,
    backgroundColor: C.accent,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: AVATAR_BORDERS.standard,
    borderColor: '#9CA3AF', // Default, overridden by gender color
  },
  userInfo: {
    flex: 1,
  },
  // CHATROOM_IDENTITY_FIX: Age shown inline as "name, age" - no separate badge styles needed
  userName: {
    // P2-001: Use responsive typography
    fontSize: CHAT_FONTS.userName,
    fontWeight: '600',
    color: C.text,
  },
  lastSeen: {
    // P2-001: Use responsive typography
    fontSize: CHAT_FONTS.secondary,
    color: C.textLight,
    marginTop: 1,
  },
  offlineLabel: {
    fontSize: CHAT_FONTS.secondary,
    fontWeight: '500',
    color: C.textLight,
  },
  emptyState: {
    alignItems: 'center',
    paddingTop: SPACING.xxl + SPACING.sm,
    gap: SPACING.sm + 2,
  },
  emptyText: {
    // P2-001: Use responsive typography
    fontSize: CHAT_FONTS.emptySubtitle,
    color: C.textLight,
  },
  // Role badges (owner/admin)
  roleBadge: {
    backgroundColor: 'rgba(109, 40, 217, 0.15)',
    paddingHorizontal: SPACING.sm,
    paddingVertical: SPACING.xxs + 1,
    borderRadius: SPACING.sm + 2,
  },
  adminBadge: {
    backgroundColor: 'rgba(59, 130, 246, 0.15)',
  },
  roleBadgeText: {
    fontSize: CHAT_FONTS.secondary,
    fontWeight: '600',
    color: '#6D28D9',
  },
  // Phase-2: Read-only badge styles
  readOnlyBadge: {
    backgroundColor: 'rgba(255, 152, 0, 0.15)',
    paddingHorizontal: SPACING.sm,
    paddingVertical: SPACING.xxs + 1,
    borderRadius: SPACING.sm + 2,
  },
  readOnlyBadgeText: {
    fontSize: CHAT_FONTS.secondary,
    fontWeight: '600',
    color: '#FF9800',
  },
});
