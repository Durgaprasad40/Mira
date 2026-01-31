import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Animated,
  PanResponder,
  TouchableOpacity,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '@/lib/constants';
import { DiscoverNotification } from '@/types';

interface NotificationBarProps {
  /** Queue of notifications to display one at a time */
  notifications: DiscoverNotification[];
  /** Number of unseen/unread notifications */
  unseenCount: number;
  onDismiss: (id: string) => void;
  onTap: (notification: DiscoverNotification) => void;
  /** Called when bar becomes visible — marks notifications as seen */
  onMarkAllSeen: () => void;
  onSeeAll?: () => void;
}

const ICON_MAP: Record<string, keyof typeof Ionicons.glyphMap> = {
  crossed_paths: 'footsteps-outline',
  new_matches: 'heart-outline',
  message_reply: 'chatbubble-outline',
  interest_match: 'sparkles-outline',
  weekly_refresh: 'refresh-outline',
};

const AUTO_DISMISS_MS = 6000;

export function NotificationBar({
  notifications,
  unseenCount,
  onDismiss,
  onTap,
  onMarkAllSeen,
  onSeeAll,
}: NotificationBarProps) {
  const translateY = useRef(new Animated.Value(-60)).current;
  const opacity = useRef(new Animated.Value(0)).current;
  const dismissTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [visibleIndex, setVisibleIndex] = useState(0);
  const prevLengthRef = useRef(0);

  const current = notifications.length > 0 ? notifications[visibleIndex % notifications.length] : null;
  const total = notifications.length;

  // When new notifications arrive, show the latest one
  useEffect(() => {
    if (notifications.length > prevLengthRef.current && notifications.length > 0) {
      setVisibleIndex(notifications.length - 1);
    }
    prevLengthRef.current = notifications.length;
  }, [notifications.length]);

  const clearTimer = useCallback(() => {
    if (dismissTimer.current) {
      clearTimeout(dismissTimer.current);
      dismissTimer.current = null;
    }
  }, []);

  const hideBar = useCallback(() => {
    clearTimer();
    Animated.parallel([
      Animated.timing(translateY, { toValue: -60, duration: 200, useNativeDriver: true }),
      Animated.timing(opacity, { toValue: 0, duration: 200, useNativeDriver: true }),
    ]).start();
  }, [translateY, opacity, clearTimer]);

  const showBar = useCallback(() => {
    clearTimer();
    Animated.parallel([
      Animated.spring(translateY, { toValue: 0, friction: 8, tension: 60, useNativeDriver: true }),
      Animated.timing(opacity, { toValue: 1, duration: 250, useNativeDriver: true }),
    ]).start();
    // Mark all as seen when bar becomes visible
    onMarkAllSeen();
    dismissTimer.current = setTimeout(() => {
      if (current) onDismiss(current.id);
    }, AUTO_DISMISS_MS);
  }, [translateY, opacity, clearTimer, current, onDismiss, onMarkAllSeen]);

  // Animate in/out when current notification changes
  useEffect(() => {
    if (current) {
      showBar();
    } else {
      hideBar();
    }
    return clearTimer;
  }, [current?.id]);

  const dismissCurrent = useCallback(() => {
    if (!current) return;
    hideBar();
    setTimeout(() => onDismiss(current.id), 220);
  }, [current, hideBar, onDismiss]);

  const goNext = useCallback(() => {
    if (total <= 1) return;
    setVisibleIndex((i) => (i + 1) % total);
  }, [total]);

  const goPrev = useCallback(() => {
    if (total <= 1) return;
    setVisibleIndex((i) => (i - 1 + total) % total);
  }, [total]);

  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, gs) => gs.dy < -5 || Math.abs(gs.dx) > 15,
      onPanResponderRelease: (_, gs) => {
        if (gs.dy < -15) {
          dismissCurrent();
        } else if (gs.dx > 30) {
          goPrev();
        } else if (gs.dx < -30) {
          goNext();
        }
      },
    })
  ).current;

  if (!current) return null;

  const iconName = ICON_MAP[current.type] || 'notifications-outline';

  return (
    <Animated.View
      style={[styles.container, { transform: [{ translateY }], opacity }]}
      {...panResponder.panHandlers}
      pointerEvents="box-none"
    >
      <TouchableOpacity
        style={styles.content}
        activeOpacity={0.8}
        onPress={() => onTap(current)}
      >
        {/* Icon with badge */}
        <View style={styles.iconWrap}>
          <Ionicons name={iconName} size={18} color={COLORS.white} />
          {unseenCount > 0 && (
            <View style={styles.badge}>
              <Text style={styles.badgeText}>{unseenCount > 9 ? '9+' : unseenCount}</Text>
            </View>
          )}
        </View>
        <View style={styles.textArea}>
          <Text style={styles.message} numberOfLines={1}>{current.message}</Text>
          {total > 1 && (
            <Text style={styles.counter}>{(visibleIndex % total) + 1}/{total}</Text>
          )}
        </View>
        {total > 1 && onSeeAll && (
          <TouchableOpacity
            onPress={(e) => { e.stopPropagation(); onSeeAll(); }}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            style={styles.seeAllBtn}
          >
            <Text style={styles.seeAllText}>All</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity
          onPress={dismissCurrent}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Ionicons name="close" size={16} color={COLORS.white} />
        </TouchableOpacity>
      </TouchableOpacity>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 8,
    left: 16,
    right: 16,
    zIndex: 100,
    height: 44,
    borderRadius: 12,
    backgroundColor: 'rgba(78, 205, 196, 0.95)',
    overflow: 'visible',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 6,
    elevation: 5,
  },
  content: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    borderRadius: 12,
    overflow: 'hidden',
  },
  iconWrap: {
    marginRight: 10,
    position: 'relative',
  },
  badge: {
    position: 'absolute',
    top: -8,
    right: -10,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: COLORS.error,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
    borderWidth: 1.5,
    borderColor: 'rgba(78, 205, 196, 0.95)',
  },
  badgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: COLORS.white,
  },
  textArea: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  message: {
    flex: 1,
    fontSize: 13,
    fontWeight: '500',
    color: COLORS.white,
  },
  counter: {
    fontSize: 11,
    fontWeight: '600',
    color: 'rgba(255,255,255,0.7)',
  },
  seeAllBtn: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    backgroundColor: 'rgba(255,255,255,0.2)',
    marginRight: 8,
  },
  seeAllText: {
    fontSize: 11,
    fontWeight: '600',
    color: COLORS.white,
  },
});
