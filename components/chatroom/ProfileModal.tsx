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
import WalletSection from './WalletSection';

const C = INCOGNITO_COLORS;
const { height: SCREEN_HEIGHT } = Dimensions.get('window');

interface ProfileModalProps {
  visible: boolean;
  onClose: () => void;
  username: string;
  avatar?: string;
  isActive: boolean;
  coins: number;
  onEditProfile?: () => void;
}

export default function ProfileModal({
  visible,
  onClose,
  username,
  avatar,
  isActive,
  coins,
  onEditProfile,
}: ProfileModalProps) {
  const translateY = useRef(new Animated.Value(SCREEN_HEIGHT)).current;

  useEffect(() => {
    Animated.spring(translateY, {
      toValue: visible ? 0 : SCREEN_HEIGHT,
      useNativeDriver: true,
      tension: 65,
      friction: 11,
    }).start();
  }, [visible]);

  if (!visible) return null;

  return (
    <View style={styles.overlay}>
      <TouchableOpacity style={styles.backdrop} onPress={onClose} activeOpacity={1} />
      <Animated.View style={[styles.sheet, { transform: [{ translateY }] }]}>
        <View style={styles.handle} />

        {/* 1) User identity row */}
        <View style={styles.identityRow}>
          {avatar ? (
            <Image source={{ uri: avatar }} style={styles.avatar} />
          ) : (
            <View style={styles.avatarPlaceholder}>
              <Ionicons name="person" size={36} color={C.textLight} />
            </View>
          )}
          <View style={styles.identityInfo}>
            <View style={styles.nameRow}>
              <Text style={styles.username}>{username}</Text>
              <View
                style={[
                  styles.statusDot,
                  { backgroundColor: isActive ? '#00B894' : C.textLight },
                ]}
              />
              <Text style={[styles.statusText, { color: isActive ? '#00B894' : C.textLight }]}>
                {isActive ? 'Active' : 'Inactive'}
              </Text>
            </View>
          </View>
        </View>

        {/* 2) Wallet section */}
        <WalletSection coins={coins} />

        {/* 3) Edit profile */}
        <TouchableOpacity style={styles.editButton} onPress={onEditProfile}>
          <Ionicons name="create-outline" size={18} color={C.text} />
          <Text style={styles.editText}>Edit Profile</Text>
        </TouchableOpacity>

        {/* Close */}
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
    zIndex: 100,
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
    gap: 20,
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: C.accent,
    alignSelf: 'center',
  },
  identityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  avatar: {
    width: 64,
    height: 64,
    borderRadius: 32,
  },
  avatarPlaceholder: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: C.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  identityInfo: {
    flex: 1,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  username: {
    fontSize: 20,
    fontWeight: '700',
    color: C.text,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  statusText: {
    fontSize: 12,
    fontWeight: '500',
  },
  editButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: C.background,
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 12,
  },
  editText: {
    fontSize: 15,
    fontWeight: '600',
    color: C.text,
  },
  closeButton: {
    alignSelf: 'center',
    paddingVertical: 12,
    paddingHorizontal: 32,
    borderRadius: 20,
    backgroundColor: C.accent,
  },
  closeText: {
    fontSize: 14,
    fontWeight: '600',
    color: C.text,
  },
});
