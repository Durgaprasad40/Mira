import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Image,
  StyleSheet,
  Dimensions,
  Modal,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { INCOGNITO_COLORS } from '@/lib/constants';
import { DemoOnlineUser } from '@/lib/demoData';

const C = INCOGNITO_COLORS;
const { width: SCREEN_WIDTH } = Dimensions.get('window');
// 3x the popup avatar (56px) = 168px, but let's make it fill nicely
const AVATAR_SIZE = Math.min(SCREEN_WIDTH * 0.6, 220);

interface ViewProfileModalProps {
  visible: boolean;
  onClose: () => void;
  user: DemoOnlineUser | null;
}

export default function ViewProfileModal({
  visible,
  onClose,
  user,
}: ViewProfileModalProps) {
  const [bioExpanded, setBioExpanded] = useState(false);

  if (!visible || !user) return null;

  const hasBio = !!user.chatBio?.trim();
  const bioText = hasBio ? user.chatBio!.trim() : 'No bio yet';
  // Show "Read more" if bio exceeds ~3 lines (~120 chars)
  const needsReadMore = hasBio && bioText.length > 120;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <View style={styles.overlay}>
        <TouchableOpacity
          style={styles.backdrop}
          onPress={onClose}
          activeOpacity={1}
        />

        <View style={styles.card}>
          {/* Close X button */}
          <TouchableOpacity
            style={styles.closeButton}
            onPress={onClose}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          >
            <Ionicons name="close" size={24} color={C.text} />
          </TouchableOpacity>

          {/* Large profile photo */}
          {user.avatar ? (
            <Image
              source={{ uri: user.avatar.replace('w=100', 'w=600') }}
              style={styles.avatar}
              resizeMode="cover"
            />
          ) : (
            <View style={styles.avatarPlaceholder}>
              <Ionicons name="person" size={64} color={C.textLight} />
            </View>
          )}

          {/* Name + details */}
          <Text style={styles.userName}>{user.username}</Text>
          {(user.age || user.gender) && (
            <Text style={styles.meta}>
              {user.age && `${user.age} years`}
              {user.age && user.gender && ' · '}
              {user.gender &&
                (user.gender === 'male'
                  ? 'Male'
                  : user.gender === 'female'
                    ? 'Female'
                    : 'Other')}
            </Text>
          )}

          {/* Online status */}
          <View style={styles.statusRow}>
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

          {/* Bio */}
          <View style={styles.bioSection}>
            <Text style={styles.bioLabel}>Bio</Text>
            <Text
              style={[styles.bioText, !hasBio && styles.bioEmpty]}
              numberOfLines={bioExpanded ? undefined : 3}
            >
              {bioText}
            </Text>
            {needsReadMore && !bioExpanded && (
              <TouchableOpacity onPress={() => setBioExpanded(true)}>
                <Text style={styles.readMore}>Read more</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.75)',
  },
  card: {
    backgroundColor: C.surface,
    borderRadius: 20,
    paddingHorizontal: 28,
    paddingTop: 44,
    paddingBottom: 28,
    alignItems: 'center',
    width: SCREEN_WIDTH * 0.82,
    maxWidth: 360,
  },
  closeButton: {
    position: 'absolute',
    top: 12,
    right: 12,
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: C.accent,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
  },
  avatar: {
    width: AVATAR_SIZE,
    height: AVATAR_SIZE,
    borderRadius: AVATAR_SIZE / 2,
    marginBottom: 16,
  },
  avatarPlaceholder: {
    width: AVATAR_SIZE,
    height: AVATAR_SIZE,
    borderRadius: AVATAR_SIZE / 2,
    backgroundColor: C.accent,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  userName: {
    fontSize: 22,
    fontWeight: '700',
    color: C.text,
    marginBottom: 4,
  },
  meta: {
    fontSize: 14,
    color: C.textLight,
    marginBottom: 8,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 4,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  statusLabel: {
    fontSize: 13,
    fontWeight: '500',
  },
  bioSection: {
    width: '100%',
    marginTop: 16,
    paddingTop: 14,
    borderTopWidth: 1,
    borderTopColor: C.accent,
  },
  bioLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: C.textLight,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 6,
  },
  bioText: {
    fontSize: 14,
    lineHeight: 20,
    color: C.text,
  },
  bioEmpty: {
    fontStyle: 'italic',
    color: C.textLight,
  },
  readMore: {
    fontSize: 13,
    fontWeight: '600',
    color: C.primary,
    marginTop: 4,
  },
});
