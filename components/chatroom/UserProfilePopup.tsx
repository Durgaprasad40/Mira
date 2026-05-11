import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Pressable,
  Animated,
  StyleSheet,
  Dimensions,
  Image,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { INCOGNITO_COLORS, lineHeight } from '@/lib/constants';
import { CHAT_FONTS, CHAT_ROOM_MAX_FONT_SCALE, SPACING, SIZES } from '@/lib/responsive';
import { DemoOnlineUser } from '@/lib/demoData';
import type { Id } from '@/convex/_generated/dataModel';

const C = INCOGNITO_COLORS;
const { height: SCREEN_HEIGHT } = Dimensions.get('window');

interface UserProfilePopupProps {
  visible: boolean;
  onClose: () => void;
  user: DemoOnlineUser | null;
  onViewProfile?: (userId: string) => void;
  onPrivateMessage?: (userId: string) => void;
  onMuteUser?: (userId: string) => void;
  onReport?: (userId: string) => void;
  isMuted?: boolean;
  roomId?: Id<'chatRooms'> | null;
  currentUserId?: string | null;
  roomCreatedBy?: string | null;
  isPrivateRoom?: boolean;
  onKickOut?: (userId: string) => void;
}

export default function UserProfilePopup({
  visible,
  onClose,
  user,
  onViewProfile,
  onPrivateMessage,
  onMuteUser,
  onReport,
  isMuted = false,
  currentUserId,
  roomCreatedBy,
  isPrivateRoom,
  onKickOut,
}: UserProfilePopupProps) {
  const insets = useSafeAreaInsets();
  const translateY = useRef(new Animated.Value(SCREEN_HEIGHT)).current;
  // Backdrop only active after open animation finishes (prevents opening touch from closing)
  const [backdropActive, setBackdropActive] = useState(false);
  const visibleRef = useRef(visible);
  visibleRef.current = visible;

  // P1-CRASH-002: Guard against setState after unmount
  const isMountedRef = useRef(true);
  useEffect(() => {
    isMountedRef.current = true;
    return () => { isMountedRef.current = false; };
  }, []);

  // Log once when popup opens (not on every render)
  useEffect(() => {
    if (visible && user) {
      if (__DEV__) console.log('[NAV] open_profile_popup', { userId: user.id, username: user.username });
    }
  }, [visible, user?.id]);

  // Animation + backdrop activation
  useEffect(() => {
    if (visible) {
      setBackdropActive(false);
      if (__DEV__) console.log('[POPUP] opened visible=true backdropActive=false');
      Animated.spring(translateY, {
        toValue: 0,
        useNativeDriver: true,
        tension: 65,
        friction: 11,
      }).start(({ finished }) => {
        // Only activate backdrop if animation finished AND popup still visible AND mounted
        if (finished && visibleRef.current && isMountedRef.current) {
          setBackdropActive(true);
          if (__DEV__) console.log('[POPUP] backdropActive=true');
        }
      });
    } else {
      setBackdropActive(false);
      Animated.spring(translateY, {
        toValue: SCREEN_HEIGHT,
        useNativeDriver: true,
        tension: 65,
        friction: 11,
      }).start();
    }
  }, [visible]);

  if (!visible || !user) return null;

  const showKick =
    !!isPrivateRoom &&
    !!currentUserId &&
    !!roomCreatedBy &&
    currentUserId === roomCreatedBy &&
    user.id !== currentUserId;

  return (
    <View style={styles.overlay}>
      {/* Backdrop: only responds to taps after animation finishes */}
      <Pressable
        style={styles.backdrop}
        onPress={() => {
          if (__DEV__) console.log('[POPUP] backdrop press', { backdropActive });
          if (backdropActive) {
            if (__DEV__) console.log('[POPUP] onClose called reason=backdrop');
            onClose();
          }
        }}
      />
      <Animated.View style={[styles.sheet, { paddingBottom: SPACING.xl + insets.bottom, transform: [{ translateY }] }]}>
        <View style={styles.handle} />

        {/* Profile header */}
        <View style={styles.profileHeader}>
          {user.avatar ? (
            <Image source={{ uri: user.avatar }} style={styles.avatar} />
          ) : (
            <View style={styles.avatarPlaceholder}>
              <Ionicons name="person" size={SIZES.icon.xl} color={C.textLight} />
            </View>
          )}
          <View style={styles.profileInfo}>
            <View style={styles.nameRow}>
              <Text maxFontSizeMultiplier={CHAT_ROOM_MAX_FONT_SCALE} style={styles.userName}>{user.username}</Text>
              <View
                style={[
                  styles.statusDot,
                  { backgroundColor: user.isOnline ? '#00B894' : C.textLight },
                ]}
              />
              <Text
                maxFontSizeMultiplier={CHAT_ROOM_MAX_FONT_SCALE}
                style={[
                  styles.statusLabel,
                  { color: user.isOnline ? '#00B894' : C.textLight },
                ]}
                numberOfLines={1}
              >
                {(user as any).bio ?? (user as any).about ?? (user as any).profileBio ?? (user as any).chatBio ?? '—'}
              </Text>
            </View>
            {(user.age || user.gender) && (
              <Text maxFontSizeMultiplier={CHAT_ROOM_MAX_FONT_SCALE} style={styles.meta}>
                {user.age && `${user.age} years`}
                {user.age && user.gender && ' · '}
                {user.gender && (user.gender === 'male' ? 'Male' : user.gender === 'female' ? 'Female' : 'Other')}
              </Text>
            )}
          </View>
        </View>

        {/* Actions */}
        <View style={styles.actions}>
          <TouchableOpacity
            style={styles.actionButton}
            onPress={() => {
              if (__DEV__) console.log('[POPUP] view_profile pressed', { userId: user.id });
              // Don't call onClose - parent changes overlay which hides this popup
              onViewProfile?.(user.id);
            }}
          >
            <Ionicons name="eye-outline" size={SIZES.icon.md} color={C.text} />
            <Text maxFontSizeMultiplier={CHAT_ROOM_MAX_FONT_SCALE} style={styles.actionText}>View Profile</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.actionButton}
            onPress={() => {
              onPrivateMessage?.(user.id);
              onClose();
            }}
          >
            <Ionicons name="chatbubble-outline" size={SIZES.icon.md} color={C.text} />
            <Text maxFontSizeMultiplier={CHAT_ROOM_MAX_FONT_SCALE} style={styles.actionText}>Private Message</Text>
          </TouchableOpacity>

          {showKick ? (
            <TouchableOpacity
              style={styles.actionButton}
              onPress={() => {
                onKickOut?.(user.id);
              }}
            >
              <Ionicons name="person-remove-outline" size={SIZES.icon.md} color="#E53935" />
              <Text maxFontSizeMultiplier={CHAT_ROOM_MAX_FONT_SCALE} style={[styles.actionText, { color: '#E53935' }]}>Kick Out</Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              style={styles.actionButton}
              onPress={() => {
                onMuteUser?.(user.id);
                onClose();
              }}
            >
              <Ionicons
                name={isMuted ? 'volume-high-outline' : 'volume-mute-outline'}
                size={SIZES.icon.md}
                color={isMuted ? '#00B894' : C.text}
              />
              <Text maxFontSizeMultiplier={CHAT_ROOM_MAX_FONT_SCALE} style={[styles.actionText, isMuted && { color: '#00B894' }]}>
                {isMuted ? 'Unmute User' : 'Mute User'}
              </Text>
            </TouchableOpacity>
          )}

          <TouchableOpacity
            style={styles.actionButton}
            onPress={() => {
              if (__DEV__) console.log('[REPORT] open', { userId: user.id });
              // Don't call onClose - parent changes overlay which hides this popup
              onReport?.(user.id);
            }}
          >
            <Ionicons name="flag-outline" size={SIZES.icon.md} color={C.primary} />
            <Text maxFontSizeMultiplier={CHAT_ROOM_MAX_FONT_SCALE} style={[styles.actionText, { color: C.primary }]}>Report</Text>
          </TouchableOpacity>
        </View>

        <TouchableOpacity
          style={styles.closeButton}
          onPress={() => {
            if (__DEV__) console.log('[POPUP] onClose called reason=button');
            onClose();
          }}
        >
          <Text maxFontSizeMultiplier={CHAT_ROOM_MAX_FONT_SCALE} style={styles.closeText}>Close</Text>
        </TouchableOpacity>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'flex-end',
    zIndex: 160,
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  sheet: {
    backgroundColor: C.surface,
    borderTopLeftRadius: SIZES.radius.lg,
    borderTopRightRadius: SIZES.radius.lg,
    paddingHorizontal: SPACING.xl,
    paddingTop: SPACING.md,
  },
  handle: {
    width: SIZES.avatar.sm + SPACING.xs,
    height: SPACING.xs,
    borderRadius: SIZES.radius.xxs,
    backgroundColor: C.accent,
    alignSelf: 'center',
    marginBottom: SPACING.base,
  },
  profileHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.md,
    marginBottom: SPACING.lg,
  },
  avatar: {
    width: SIZES.avatar.lg,
    height: SIZES.avatar.lg,
    borderRadius: SIZES.avatar.lg / 2,
  },
  avatarPlaceholder: {
    width: SIZES.avatar.lg,
    height: SIZES.avatar.lg,
    borderRadius: SIZES.avatar.lg / 2,
    backgroundColor: C.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  profileInfo: {
    flex: 1,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
  },
  userName: {
    fontSize: CHAT_FONTS.panelTitle,
    fontWeight: '700',
    lineHeight: lineHeight(CHAT_FONTS.panelTitle, 1.2),
    color: C.text,
  },
  statusDot: {
    width: SPACING.sm,
    height: SPACING.sm,
    borderRadius: SPACING.sm / 2,
  },
  statusLabel: {
    fontSize: CHAT_FONTS.secondary,
    fontWeight: '500',
    lineHeight: lineHeight(CHAT_FONTS.secondary, 1.2),
  },
  meta: {
    fontSize: CHAT_FONTS.label,
    lineHeight: lineHeight(CHAT_FONTS.label, 1.35),
    color: C.textLight,
    marginTop: SPACING.xxs,
  },
  actions: {
    gap: SPACING.xxs,
  },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.md,
    paddingVertical: SPACING.md,
    paddingHorizontal: SPACING.xs,
    borderBottomWidth: 1,
    borderBottomColor: C.accent,
  },
  actionText: {
    fontSize: CHAT_FONTS.buttonText,
    fontWeight: '500',
    lineHeight: lineHeight(CHAT_FONTS.buttonText, 1.2),
    color: C.text,
  },
  closeButton: {
    alignSelf: 'center',
    paddingVertical: SPACING.md,
    paddingHorizontal: SPACING.xxl,
    borderRadius: SIZES.radius.lg,
    backgroundColor: C.accent,
    marginTop: SPACING.lg,
  },
  closeText: {
    fontSize: CHAT_FONTS.buttonText,
    fontWeight: '600',
    lineHeight: lineHeight(CHAT_FONTS.buttonText, 1.2),
    color: C.text,
  },
});
