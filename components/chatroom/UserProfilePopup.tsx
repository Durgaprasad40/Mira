import React, { useEffect, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Animated,
  StyleSheet,
  Dimensions,
  Image,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { INCOGNITO_COLORS } from '@/lib/constants';
import { DemoOnlineUser } from '@/lib/demoData';

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
}: UserProfilePopupProps) {
  const translateY = useRef(new Animated.Value(SCREEN_HEIGHT)).current;

  useEffect(() => {
    Animated.spring(translateY, {
      toValue: visible ? 0 : SCREEN_HEIGHT,
      useNativeDriver: true,
      tension: 65,
      friction: 11,
    }).start();
  }, [visible]);

  if (!visible || !user) return null;

  return (
    <View style={styles.overlay}>
      <TouchableOpacity style={styles.backdrop} onPress={onClose} activeOpacity={1} />
      <Animated.View style={[styles.sheet, { transform: [{ translateY }] }]}>
        <View style={styles.handle} />

        {/* Profile header */}
        <View style={styles.profileHeader}>
          {user.avatar ? (
            <Image source={{ uri: user.avatar }} style={styles.avatar} />
          ) : (
            <View style={styles.avatarPlaceholder}>
              <Ionicons name="person" size={32} color={C.textLight} />
            </View>
          )}
          <View style={styles.profileInfo}>
            <View style={styles.nameRow}>
              <Text style={styles.userName}>{user.username}</Text>
              <View
                style={[
                  styles.statusDot,
                  { backgroundColor: user.isOnline ? '#00B894' : C.textLight },
                ]}
              />
              <Text
                style={[
                  styles.statusLabel,
                  { color: user.isOnline ? '#00B894' : C.textLight },
                ]}
              >
                {user.isOnline ? 'Online' : 'Offline'}
              </Text>
            </View>
            {(user.age || user.gender) && (
              <Text style={styles.meta}>
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
              onViewProfile?.(user.id);
              onClose();
            }}
          >
            <Ionicons name="eye-outline" size={20} color={C.text} />
            <Text style={styles.actionText}>View Profile</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.actionButton}
            onPress={() => {
              onPrivateMessage?.(user.id);
              onClose();
            }}
          >
            <Ionicons name="chatbubble-outline" size={20} color={C.text} />
            <Text style={styles.actionText}>Private Message</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.actionButton}
            onPress={() => {
              onMuteUser?.(user.id);
              onClose();
            }}
          >
            <Ionicons
              name={isMuted ? 'volume-high-outline' : 'volume-mute-outline'}
              size={20}
              color={isMuted ? '#00B894' : C.text}
            />
            <Text style={[styles.actionText, isMuted && { color: '#00B894' }]}>
              {isMuted ? 'Unmute User' : 'Mute User'}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.actionButton}
            onPress={() => {
              onReport?.(user.id);
              onClose();
            }}
          >
            <Ionicons name="flag-outline" size={20} color={C.primary} />
            <Text style={[styles.actionText, { color: C.primary }]}>Report</Text>
          </TouchableOpacity>
        </View>

        <TouchableOpacity style={styles.closeButton} onPress={onClose}>
          <Text style={styles.closeText}>Close</Text>
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
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 24,
    paddingBottom: 40,
    paddingTop: 12,
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: C.accent,
    alignSelf: 'center',
    marginBottom: 16,
  },
  profileHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    marginBottom: 20,
  },
  avatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
  },
  avatarPlaceholder: {
    width: 56,
    height: 56,
    borderRadius: 28,
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
    gap: 8,
  },
  userName: {
    fontSize: 18,
    fontWeight: '700',
    color: C.text,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  statusLabel: {
    fontSize: 12,
    fontWeight: '500',
  },
  meta: {
    fontSize: 13,
    color: C.textLight,
    marginTop: 3,
  },
  actions: {
    gap: 2,
  },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 14,
    paddingHorizontal: 4,
    borderBottomWidth: 1,
    borderBottomColor: C.accent,
  },
  actionText: {
    fontSize: 15,
    fontWeight: '500',
    color: C.text,
  },
  closeButton: {
    alignSelf: 'center',
    paddingVertical: 12,
    paddingHorizontal: 32,
    borderRadius: 20,
    backgroundColor: C.accent,
    marginTop: 20,
  },
  closeText: {
    fontSize: 14,
    fontWeight: '600',
    color: C.text,
  },
});
