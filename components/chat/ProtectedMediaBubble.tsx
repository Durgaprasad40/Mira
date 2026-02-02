import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useQuery } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { COLORS } from '@/lib/constants';

interface ProtectedMediaBubbleProps {
  mediaId?: string;
  userId?: string;
  // Legacy props — used if mediaId isn't provided
  protectedMedia?: {
    timer: number;
    screenshotAllowed: boolean;
    viewOnce: boolean;
    watermark: boolean;
  };
  isExpired?: boolean;
  isOwn: boolean;
  onPress: () => void;
}

export function ProtectedMediaBubble({
  mediaId,
  userId,
  protectedMedia,
  isExpired: isExpiredProp,
  isOwn,
  onPress,
}: ProtectedMediaBubbleProps) {
  // Fetch media info from the new table if mediaId is provided
  const mediaInfo = useQuery(
    api.media.getMediaInfo,
    mediaId && userId ? { mediaId: mediaId as any, userId: userId as any } : 'skip'
  );

  // Use fetched data or fall back to legacy props
  const timerSeconds = mediaInfo?.timerSeconds ?? protectedMedia?.timer ?? 0;
  const canScreenshot = mediaInfo?.canScreenshot ?? protectedMedia?.screenshotAllowed ?? false;
  const viewOnce = mediaInfo?.viewOnce ?? protectedMedia?.viewOnce ?? false;
  const watermark = mediaInfo?.watermarkEnabled ?? protectedMedia?.watermark ?? false;
  const isExpired = mediaInfo?.isExpired ?? isExpiredProp ?? false;

  if (isExpired) {
    return (
      <View style={styles.expiredContainer}>
        <Ionicons name="lock-closed" size={28} color={COLORS.textMuted} />
        <Text style={styles.expiredText}>Expired</Text>
      </View>
    );
  }

  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.7}>
      <LinearGradient
        colors={['#2C2C3A', '#1E1E2E']}
        style={styles.activeContainer}
      >
        <Ionicons name="shield-checkmark" size={32} color={COLORS.primary} />
        <Text style={styles.label}>Protected Photo</Text>
        <Text style={styles.tapHint}>Tap to view</Text>

        <View style={styles.badges}>
          {timerSeconds > 0 && (
            <View style={styles.badge}>
              <Ionicons name="timer-outline" size={12} color={COLORS.white} />
              <Text style={styles.badgeText}>{timerSeconds}s</Text>
            </View>
          )}
          {!canScreenshot && (
            <View style={styles.badge}>
              <Ionicons name="eye-off-outline" size={12} color={COLORS.white} />
            </View>
          )}
          {viewOnce && (
            <View style={styles.badge}>
              <Text style={styles.badgeText}>1x</Text>
            </View>
          )}
          {watermark && (
            <View style={styles.badge}>
              <Ionicons name="water-outline" size={12} color={COLORS.white} />
            </View>
          )}
        </View>
      </LinearGradient>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  expiredContainer: {
    width: 200,
    height: 150,
    borderRadius: 12,
    backgroundColor: COLORS.backgroundDark,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  expiredText: {
    fontSize: 13,
    color: COLORS.textMuted,
    fontWeight: '500',
  },
  activeContainer: {
    width: 200,
    height: 150,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    overflow: 'hidden',
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.white,
    marginTop: 4,
  },
  tapHint: {
    fontSize: 11,
    color: 'rgba(255,255,255,0.5)',
  },
  badges: {
    flexDirection: 'row',
    gap: 6,
    marginTop: 8,
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: 'rgba(255,255,255,0.15)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 8,
  },
  badgeText: {
    fontSize: 10,
    color: COLORS.white,
    fontWeight: '600',
  },
});
