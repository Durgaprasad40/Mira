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
import { Ionicons } from '@expo/vector-icons';
import { INCOGNITO_COLORS } from '@/lib/constants';

const C = INCOGNITO_COLORS;

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
      <Ionicons name={name} size={21} color={C.text} />
      {!!count && count > 0 && (
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{count > 99 ? '99+' : count}</Text>
        </View>
      )}
    </TouchableOpacity>
  );
}

interface ChatHeaderProps {
  onMenuPress?: () => void;
  onReloadPress?: () => void;
  onMessagesPress?: () => void;
  onFriendRequestsPress?: () => void;
  onNotificationsPress?: () => void;
  onProfilePress?: () => void;
  profileAvatar?: string;
  unreadDMs?: number;
  pendingFriendRequests?: number;
  unseenNotifications?: number;
  /** Safe-area top inset — header background extends behind status bar */
  topInset?: number;
}

export default function ChatHeader({
  onMenuPress,
  onReloadPress,
  onMessagesPress,
  onFriendRequestsPress,
  onNotificationsPress,
  onProfilePress,
  profileAvatar,
  unreadDMs = 0,
  pendingFriendRequests = 0,
  unseenNotifications = 0,
  topInset = 0,
}: ChatHeaderProps) {
  const spinAnim = useRef(new Animated.Value(0)).current;
  const isSpinning = useRef(false);

  const handleReload = useCallback(() => {
    if (isSpinning.current) return; // ignore taps while spinning
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
    onReloadPress?.();
  }, [onReloadPress, spinAnim]);

  const spin = spinAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });

  return (
    <View style={[styles.container, topInset > 0 && { paddingTop: topInset + 4 }]}>
      {/* Left: Menu icon */}
      <TouchableOpacity
        onPress={onMenuPress}
        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
      >
        <Ionicons name="menu" size={24} color={C.text} />
      </TouchableOpacity>

      {/* Center: spacer */}
      <View style={styles.spacer} />

      {/* Right: action icons */}
      <View style={styles.rightIcons}>
        {/* Reload with spin */}
        <TouchableOpacity
          onPress={handleReload}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          style={styles.iconWrapper}
        >
          <Animated.View style={{ transform: [{ rotate: spin }] }}>
            <Ionicons name="reload" size={21} color={C.text} />
          </Animated.View>
        </TouchableOpacity>

        <BadgeIcon
          name="chatbubble-ellipses-outline"
          count={unreadDMs}
          onPress={onMessagesPress}
        />

        <BadgeIcon
          name="person-add-outline"
          count={pendingFriendRequests}
          onPress={onFriendRequestsPress}
        />

        <BadgeIcon
          name="notifications-outline"
          count={unseenNotifications}
          onPress={onNotificationsPress}
        />

        <TouchableOpacity onPress={onProfilePress}>
          {profileAvatar ? (
            <Image source={{ uri: profileAvatar }} style={styles.avatar} />
          ) : (
            <View style={styles.avatarPlaceholder}>
              <Ionicons name="person" size={16} color={C.textLight} />
            </View>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 4,
    backgroundColor: C.surface,
    borderBottomWidth: 1,
    borderBottomColor: C.accent,
    gap: 8,
  },
  spacer: {
    flex: 1,
  },
  rightIcons: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  iconWrapper: {
    position: 'relative',
  },
  badge: {
    position: 'absolute',
    top: -6,
    right: -8,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: C.primary,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  badgeText: {
    fontSize: 9,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  avatar: {
    width: 30,
    height: 30,
    borderRadius: 15,
  },
  avatarPlaceholder: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: C.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
