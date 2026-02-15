/**
 * ChatRoomsHeader - Shared header component for Chat Rooms screens
 * Purple/blue gradient bar with menu, refresh, inbox, bell, and profile icons.
 * NO friend request icon per requirements.
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
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';

// Header bar gradient colors (purple to blue)
const HEADER_GRADIENT: readonly [string, string] = ['#6B5CE7', '#4A90D9'] as const;
const HEADER_TEXT_COLOR = '#FFFFFF';

interface BadgeIconProps {
  name: keyof typeof Ionicons.glyphMap;
  count?: number;
  onPress?: () => void;
}

function BadgeIcon({ name, count, onPress }: BadgeIconProps) {
  return (
    <TouchableOpacity
      onPress={onPress}
      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      style={styles.iconWrapper}
    >
      <Ionicons name={name} size={22} color={HEADER_TEXT_COLOR} />
      {!!count && count > 0 && (
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
  /** Called when bell/notifications pressed */
  onNotificationsPress?: () => void;
  /** Called when profile avatar pressed */
  onProfilePress?: () => void;
  /** Profile avatar URL */
  profileAvatar?: string;
  /** Unread inbox count */
  unreadInbox?: number;
  /** Unseen notifications count */
  unseenNotifications?: number;
  /** Safe-area top inset */
  topInset?: number;
  /** Show create room button (+ icon) */
  showCreateButton?: boolean;
  /** Called when create button pressed */
  onCreatePress?: () => void;
}

export default function ChatRoomsHeader({
  title = 'Chat Rooms',
  showBackButton = false,
  hideLeftButton = false,
  onMenuPress,
  onRefreshPress,
  onInboxPress,
  onNotificationsPress,
  onProfilePress,
  profileAvatar,
  unreadInbox = 0,
  unseenNotifications = 0,
  topInset = 0,
  showCreateButton = false,
  onCreatePress,
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
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 0 }}
      style={[styles.container, { paddingTop: topInset + 8 }]}
    >
      {/* Left: Menu or Back (hidden if hideLeftButton) */}
      {!hideLeftButton && (
        <TouchableOpacity
          onPress={onMenuPress}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          style={styles.menuButton}
        >
          <Ionicons
            name={showBackButton ? 'arrow-back' : 'menu'}
            size={26}
            color={HEADER_TEXT_COLOR}
          />
        </TouchableOpacity>
      )}

      {/* Center: Title */}
      <View style={styles.titleContainer}>
        <Text style={styles.title} numberOfLines={1}>
          {title}
        </Text>
      </View>

      {/* Right: Action icons */}
      <View style={styles.rightIcons}>
        {/* Create room button (optional) */}
        {showCreateButton && (
          <TouchableOpacity
            onPress={onCreatePress}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            style={styles.iconWrapper}
          >
            <Ionicons name="add-circle-outline" size={24} color={HEADER_TEXT_COLOR} />
          </TouchableOpacity>
        )}

        {/* Refresh with spin animation */}
        <TouchableOpacity
          onPress={handleRefresh}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          style={styles.iconWrapper}
        >
          <Animated.View style={{ transform: [{ rotate: spin }] }}>
            <Ionicons name="refresh" size={22} color={HEADER_TEXT_COLOR} />
          </Animated.View>
        </TouchableOpacity>

        {/* Inbox/Mail */}
        <BadgeIcon
          name="mail-outline"
          count={unreadInbox}
          onPress={onInboxPress}
        />

        {/* Notifications bell */}
        <BadgeIcon
          name="notifications-outline"
          count={unseenNotifications}
          onPress={onNotificationsPress}
        />

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

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingBottom: 12,
  },
  menuButton: {
    padding: 4,
  },
  titleContainer: {
    flex: 1,
    marginLeft: 12,
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    color: HEADER_TEXT_COLOR,
  },
  rightIcons: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  iconWrapper: {
    position: 'relative',
  },
  badge: {
    position: 'absolute',
    top: -6,
    right: -8,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: '#FF4757',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
    borderWidth: 2,
    borderColor: '#6B5CE7',
  },
  badgeText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  avatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.3)',
  },
  avatarPlaceholder: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.3)',
  },
});
