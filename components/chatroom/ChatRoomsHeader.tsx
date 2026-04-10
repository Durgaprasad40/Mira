/**
 * ChatRoomsHeader - Shared header component for Chat Rooms screens
 * Premium purple/blue gradient bar with menu, refresh, inbox, bell, and profile icons.
 * NO friend request icon per requirements.
 * P0-002 FIX: Uses responsive sizing for cross-device consistency.
 */
import React, { useRef, useCallback } from 'react';
import {
  View,
  TouchableOpacity,
  Image,
  Text,
  StyleSheet,
  Animated,
  Easing,
  Platform,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { CHAT_SIZES, CHAT_FONTS, SPACING, SIZES } from '@/lib/responsive';

// Clean gradient - purple to blue
const HEADER_GRADIENT: readonly [string, string] = ['#6D28D9', '#4F46E5'] as const;
const HEADER_TEXT_COLOR = '#FFFFFF';

interface BadgeIconProps {
  name: keyof typeof Ionicons.glyphMap;
  count?: number;
  onPress?: () => void;
}

function BadgeIcon({ name, count, onPress }: BadgeIconProps) {
  const hasCount = !!count && count > 0;
  return (
    <TouchableOpacity
      onPress={onPress}
      hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
      style={styles.iconWrapper}
    >
      {/* P0-002 FIX: Use responsive icon size */}
      <Ionicons name={name} size={CHAT_SIZES.headerIconSm} color={HEADER_TEXT_COLOR} />
      {hasCount && (
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{count > 99 ? '99+' : count}</Text>
        </View>
      )}
    </TouchableOpacity>
  );
}

interface ChatRoomsHeaderProps {
  /** Title to display (e.g., "Chat Rooms" or room name) */
  title?: string;
  /** Subtitle to display below title (e.g., countdown timer) */
  subtitle?: string;
  /** Real-time online count for this room (heartbeat-based) */
  onlineCount?: number;
  /** Show back arrow instead of menu */
  showBackButton?: boolean;
  /** Hide the left button entirely (no menu or back icon) */
  hideLeftButton?: boolean;
  /** Called when menu/back button pressed */
  onMenuPress?: () => void;
  /** Called when refresh button pressed */
  onRefreshPress?: () => void;
  /** Called when inbox/mail icon pressed */
  onInboxPress?: () => void;
  /** Called when profile avatar pressed */
  onProfilePress?: () => void;
  /** Profile avatar URL */
  profileAvatar?: string;
  /** Unread inbox count */
  unreadInbox?: number;
  /** Safe-area top inset */
  topInset?: number;
  /** Show create room button (+ icon) */
  showCreateButton?: boolean;
  /** Called when create button pressed */
  onCreatePress?: () => void;
  /** Phase-2: Hide inbox and notifications icons (for private rooms) */
  hideInboxAndNotifications?: boolean;
  /** Show 24-hour message retention indicator below title */
  showRetentionIndicator?: boolean;
}

export default function ChatRoomsHeader({
  title = 'Chat Rooms',
  subtitle,
  onlineCount,
  showBackButton = false,
  hideLeftButton = false,
  onMenuPress,
  onRefreshPress,
  onInboxPress,
  onProfilePress,
  profileAvatar,
  unreadInbox = 0,
  topInset = 0,
  showCreateButton = false,
  onCreatePress,
  hideInboxAndNotifications = false,
  showRetentionIndicator = false,
}: ChatRoomsHeaderProps) {
  const spinAnim = useRef(new Animated.Value(0)).current;
  const isSpinning = useRef(false);

  const handleRefresh = useCallback(() => {
    if (isSpinning.current) return;
    isSpinning.current = true;
    spinAnim.setValue(0);
    Animated.timing(spinAnim, {
      toValue: 1,
      duration: 800,
      easing: Easing.linear,
      useNativeDriver: true,
    }).start(() => {
      isSpinning.current = false;
    });
    onRefreshPress?.();
  }, [onRefreshPress, spinAnim]);

  const spin = spinAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });

  return (
    <LinearGradient
      colors={HEADER_GRADIENT}
      start={{ x: 0, y: 0.5 }}
      end={{ x: 1, y: 0.5 }}
      style={[styles.container, { paddingTop: topInset + 8 }]}
    >
      {/* Left: Menu or Back (hidden if hideLeftButton) */}
      {/* P2-006: Ensure 44pt minimum touch targets */}
      {!hideLeftButton && (
        <TouchableOpacity
          onPress={onMenuPress}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          style={styles.menuButton}
        >
          {/* P0-002 FIX: Use responsive icon size */}
          <Ionicons
            name={showBackButton ? 'arrow-back' : 'menu'}
            size={CHAT_SIZES.headerIconLg}
            color={HEADER_TEXT_COLOR}
          />
        </TouchableOpacity>
      )}

      {/* Center: Title + online count + optional subtitle */}
      <View style={styles.titleContainer}>
        <View style={styles.titleRow}>
          <Text style={styles.title} numberOfLines={1}>
            {title}
          </Text>
          {onlineCount !== undefined && onlineCount > 0 && (
            <View style={styles.onlineIndicator}>
              <View style={styles.onlineDot} />
              <Text style={styles.onlineText}>{onlineCount}</Text>
            </View>
          )}
        </View>
        {subtitle && (
          <Text style={styles.subtitle} numberOfLines={1}>
            {subtitle}
          </Text>
        )}
        {/* 24-hour retention indicator */}
        {showRetentionIndicator && (
          <Text style={styles.retentionText} numberOfLines={1}>
            Messages disappear after 24 hours
          </Text>
        )}
      </View>

      {/* Right: Action icons */}
      <View style={styles.rightIcons}>
        {/* Phase-2: Close room button removed from header - End Room is in profile menu */}

        {/* Create room button (optional) */}
        {showCreateButton && (
          <TouchableOpacity
            onPress={onCreatePress}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            style={styles.iconWrapper}
          >
            {/* P0-002 FIX: Use responsive icon size */}
            <Ionicons name="add-circle-outline" size={CHAT_SIZES.headerIconMd} color={HEADER_TEXT_COLOR} />
          </TouchableOpacity>
        )}

        {/* Refresh with spin animation */}
        <TouchableOpacity
          onPress={handleRefresh}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          style={styles.iconWrapper}
        >
          <Animated.View style={{ transform: [{ rotate: spin }] }}>
            {/* P0-002 FIX: Use responsive icon size */}
            <Ionicons name="refresh" size={CHAT_SIZES.headerIconSm} color={HEADER_TEXT_COLOR} />
          </Animated.View>
        </TouchableOpacity>

        {/* Inbox/Mail (hidden for private rooms) */}
        {!hideInboxAndNotifications && (
          <BadgeIcon
            name="mail-outline"
            count={unreadInbox}
            onPress={onInboxPress}
          />
        )}

        {/* @Mentions moved to composer area - no longer in header */}

        {/* Profile avatar */}
        <TouchableOpacity onPress={onProfilePress}>
          {profileAvatar ? (
            <Image source={{ uri: profileAvatar }} style={styles.avatar} />
          ) : (
            <View style={styles.avatarPlaceholder}>
              <Ionicons name="person" size={16} color={HEADER_TEXT_COLOR} />
            </View>
          )}
        </TouchableOpacity>
      </View>
    </LinearGradient>
  );
}

// P0-002 FIX: Use responsive sizes for avatars
const AVATAR_SIZE = CHAT_SIZES.headerAvatar;

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: SPACING.md,
    paddingBottom: SPACING.md,
  },
  menuButton: {
    padding: SPACING.xs,
  },
  titleContainer: {
    flex: 1,
    minWidth: 0, // Enable text truncation in flex children
    marginLeft: SPACING.md,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    minWidth: 0, // Enable text truncation
  },
  title: {
    // P0-002 FIX: Responsive font size for header title
    fontSize: CHAT_FONTS.headerTitle,
    fontWeight: '700',
    color: HEADER_TEXT_COLOR,
    flexShrink: 1,
    minWidth: 0, // Enable truncation
  },
  onlineIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(34, 197, 94, 0.2)',
    paddingHorizontal: SPACING.sm,
    paddingVertical: 3,
    borderRadius: SIZES.radius.md,
    gap: SPACING.xs,
  },
  onlineDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#22C55E',
  },
  onlineText: {
    // P0-002 FIX: Responsive font size
    fontSize: CHAT_FONTS.onlineCount,
    fontWeight: '600',
    color: '#22C55E',
  },
  subtitle: {
    // P0-002 FIX: Responsive font size
    fontSize: CHAT_FONTS.headerSubtitle,
    fontWeight: '500',
    color: 'rgba(255,255,255,0.75)',
    marginTop: 2,
  },
  retentionText: {
    // 24-hour retention indicator - subtle and compact
    fontSize: 11,
    fontWeight: '400',
    color: 'rgba(255,255,255,0.5)',
    marginTop: 2,
  },
  rightIcons: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.base,
  },
  iconWrapper: {
    position: 'relative',
  },
  badge: {
    position: 'absolute',
    // P2-011: Use responsive spacing for badge position
    top: -SPACING.xs,
    right: -SPACING.sm,
    minWidth: SIZES.badgeSize,
    height: SIZES.badgeSize,
    borderRadius: SIZES.badgeSize / 2,
    backgroundColor: '#EF4444',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: SPACING.xs,
  },
  badgeText: {
    // P0-002 FIX: Responsive font size
    fontSize: CHAT_FONTS.badgeText,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  avatar: {
    // P0-002 FIX: Responsive avatar size
    width: AVATAR_SIZE,
    height: AVATAR_SIZE,
    borderRadius: AVATAR_SIZE / 2,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.4)',
  },
  avatarPlaceholder: {
    // P0-002 FIX: Responsive avatar size
    width: AVATAR_SIZE,
    height: AVATAR_SIZE,
    borderRadius: AVATAR_SIZE / 2,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
