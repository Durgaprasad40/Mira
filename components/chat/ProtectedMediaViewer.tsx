import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  ActivityIndicator,
  Dimensions,
  Platform,
} from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery, useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { COLORS } from '@/lib/constants';
import { useScreenshotDetection } from '@/hooks/useScreenshotDetection';
import { useScreenProtection } from '@/hooks/useScreenProtection';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

interface ProtectedMediaViewerProps {
  visible: boolean;
  messageId: string;
  userId: string;
  viewerName: string;
  onClose: () => void;
  onReport?: () => void;
}

export function ProtectedMediaViewer({
  visible,
  messageId,
  userId,
  viewerName,
  onClose,
  onReport,
}: ProtectedMediaViewerProps) {
  const insets = useSafeAreaInsets();
  const [timeLeft, setTimeLeft] = useState<number | null>(null);
  const [mediaUrl, setMediaUrl] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const hasMarkedViewed = useRef(false);
  // 5-2: Prevent duplicate markExpired calls
  const hasExpired = useRef(false);
  // 5-1: Track mounted state to prevent setState after unmount
  const mountedRef = useRef(true);
  const [requestedAccess, setRequestedAccess] = useState(false);

  // 5-1: Track mounted state
  React.useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      // 5-1: Clear any pending timers on unmount
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, []);

  const mediaData = useQuery(
    api.protectedMedia.getMediaUrl,
    visible && messageId ? { messageId: messageId as any, userId: userId as any } : 'skip'
  );

  const markViewed = useMutation(api.protectedMedia.markViewed);
  const markExpired = useMutation(api.protectedMedia.markExpired);
  const logScreenshot = useMutation(api.protectedMedia.logScreenshotEvent);
  const requestAccess = useMutation(api.permissions.requestScreenshotAccess);

  const allowScreenshot = mediaData?.allowScreenshot ?? false;
  const shouldBlur = mediaData?.shouldBlur ?? true;
  const watermarkText = mediaData?.watermarkText ?? null;
  const mediaId = mediaData?.mediaId ?? null;

  // Screen protection (Android FLAG_SECURE) — block when screenshots not allowed
  useScreenProtection(!allowScreenshot && visible);

  // Screenshot detection — fires on both platforms
  const handleScreenshot = useCallback(() => {
    if (messageId && userId) {
      logScreenshot({
        messageId: messageId as any,
        userId: userId as any,
        wasTaken: true,
      });
    }
  }, [messageId, userId, logScreenshot]);

  useScreenshotDetection({
    enabled: visible,
    onScreenshot: handleScreenshot,
  });

  // 6-2: Define handleClose BEFORE other callbacks that reference it
  const handleClose = useCallback(() => {
    // 5-1: Clear timer before any state changes
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }

    // 5-2: If view-once, expire on close (only once)
    if (mediaData?.viewOnce && !hasExpired.current) {
      hasExpired.current = true;
      markExpired({
        messageId: messageId as any,
        userId: userId as any,
      });
    }

    // 5-1: Only update state if still mounted
    if (mountedRef.current) {
      setMediaUrl(null);
      setTimeLeft(null);
      setRequestedAccess(false);
    }
    hasMarkedViewed.current = false;
    hasExpired.current = false; // Reset for next open
    onClose();
  }, [mediaData, messageId, userId, markExpired, onClose]);

  // Load media URL and mark viewed
  // 6-1: Added handleClose to deps to avoid stale closure
  useEffect(() => {
    if (visible && mediaData?.url && !hasMarkedViewed.current) {
      setMediaUrl(mediaData.url);
      hasMarkedViewed.current = true;

      markViewed({
        messageId: messageId as any,
        userId: userId as any,
      });

      // Start timer if applicable
      if (mediaData.timerSeconds && mediaData.timerSeconds > 0) {
        setTimeLeft(mediaData.timerSeconds);
      }
    }

    if (visible && mediaData?.isExpired) {
      handleClose();
    }
  }, [visible, mediaData, handleClose, markViewed, messageId, userId]);

  // 6-2: handleExpire now includes handleClose in deps (no stale closure)
  const handleExpire = useCallback(() => {
    if (hasExpired.current) return; // Already expired
    hasExpired.current = true;
    markExpired({
      messageId: messageId as any,
      userId: userId as any,
    });
    handleClose();
  }, [messageId, userId, markExpired, handleClose]);

  // Countdown timer - sets up interval when timer starts
  // 5-1: Check mountedRef before setState to prevent memory leaks
  useEffect(() => {
    // 6-3: Skip if no timer or timer already at 0 (handled by separate effect below)
    if (timeLeft === null || timeLeft <= 0) {
      return;
    }

    timerRef.current = setInterval(() => {
      // 5-1: Guard against setState after unmount
      if (!mountedRef.current) {
        if (timerRef.current) clearInterval(timerRef.current);
        return;
      }
      setTimeLeft((prev) => {
        if (prev === null || prev <= 1) {
          if (timerRef.current) clearInterval(timerRef.current);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  // 6-3: Changed from [timeLeft !== null] to proper check - only re-run when timeLeft transitions
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timeLeft === null || timeLeft <= 0]);

  // 6-3: Separate effect to handle timer expiry (fixes bug where timer hitting 0 never called handleExpire)
  useEffect(() => {
    if (timeLeft === 0) {
      handleExpire();
    }
  }, [timeLeft, handleExpire]);

  const handleRequestAccess = useCallback(() => {
    if (mediaId) {
      requestAccess({
        mediaId: mediaId as any,
        requesterId: userId as any,
      });
      setRequestedAccess(true);
    }
  }, [mediaId, userId, requestAccess]);

  if (!visible) return null;

  const isLoading = !mediaUrl && !mediaData?.isExpired;
  const isExpired = mediaData?.isExpired;

  return (
    <Modal visible={visible} transparent animationType="fade">
      <View style={styles.container}>
        {/* Header */}
        <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
          <TouchableOpacity onPress={handleClose} style={styles.closeButton}>
            <Ionicons name="close" size={28} color={COLORS.white} />
          </TouchableOpacity>

          <View style={styles.headerRight}>
            {timeLeft !== null && timeLeft > 0 && (
              <View style={styles.timerBadge}>
                <Ionicons name="timer-outline" size={16} color={COLORS.white} />
                <Text style={styles.timerText}>{timeLeft}s</Text>
              </View>
            )}

            {onReport && (
              <TouchableOpacity onPress={onReport} style={styles.reportButton}>
                <Ionicons name="flag-outline" size={20} color={COLORS.textMuted} />
              </TouchableOpacity>
            )}
          </View>
        </View>

        {/* Trust signal banner */}
        <View style={styles.trustBanner}>
          {allowScreenshot ? (
            <View style={styles.trustRow}>
              <Ionicons name="shield-checkmark-outline" size={14} color="#4CAF50" />
              <Text style={[styles.trustText, { color: '#4CAF50' }]}>Screenshot allowed</Text>
            </View>
          ) : (
            <View style={styles.trustRow}>
              <Ionicons name="shield" size={14} color={COLORS.primary} />
              <Text style={[styles.trustText, { color: COLORS.primary }]}>Screenshot blocked</Text>
            </View>
          )}
        </View>

        {/* Content */}
        {isLoading ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color={COLORS.primary} />
            <Text style={styles.loadingText}>Loading protected photo...</Text>
          </View>
        ) : isExpired ? (
          <View style={styles.expiredContainer}>
            <Ionicons name="lock-closed" size={48} color={COLORS.textMuted} />
            <Text style={styles.expiredText}>This media has expired</Text>
            <TouchableOpacity onPress={handleClose} style={styles.expiredButton}>
              <Text style={styles.expiredButtonText}>Go Back</Text>
            </TouchableOpacity>
          </View>
        ) : mediaUrl ? (
          <View style={styles.imageContainer}>
            {/* Blur overlay when screenshots not allowed (iOS) */}
            {shouldBlur && Platform.OS === 'ios' ? (
              <View style={styles.blurWrapper}>
                <Image
                  source={{ uri: mediaUrl }}
                  style={styles.image}
                  contentFit="contain"
                  blurRadius={20}
                />
                <View style={styles.blurOverlay}>
                  <Ionicons name="eye-off" size={32} color={COLORS.white} />
                  <Text style={styles.blurText}>Screenshot not allowed by sender</Text>
                  {!requestedAccess ? (
                    <TouchableOpacity
                      style={styles.requestAccessButton}
                      onPress={handleRequestAccess}
                    >
                      <Text style={styles.requestAccessText}>Request Access</Text>
                    </TouchableOpacity>
                  ) : (
                    <Text style={styles.accessRequestedText}>Access requested</Text>
                  )}
                </View>
              </View>
            ) : shouldBlur && Platform.OS === 'android' ? (
              // Android: FLAG_SECURE blocks the screenshot; show clear image
              <Image
                source={{ uri: mediaUrl }}
                style={styles.image}
                contentFit="contain"
              />
            ) : (
              // Screenshot allowed — show clear image
              <Image
                source={{ uri: mediaUrl }}
                style={styles.image}
                contentFit="contain"
              />
            )}

            {/* Watermark overlay */}
            {watermarkText && (
              <View style={styles.watermarkContainer} pointerEvents="none">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Text
                    key={i}
                    style={[
                      styles.watermarkText,
                      {
                        top: 80 + i * 140,
                        transform: [{ rotate: '-30deg' }],
                      },
                    ]}
                  >
                    {watermarkText}
                  </Text>
                ))}
              </View>
            )}
          </View>
        ) : null}

        {/* Footer info */}
        <View style={[styles.footer, { paddingBottom: insets.bottom + 16 }]}>
          <View style={styles.infoRow}>
            <Ionicons name="shield-checkmark" size={16} color={COLORS.primary} />
            <Text style={styles.infoText}>Protected Photo</Text>
          </View>
          {!allowScreenshot && (
            <View style={styles.infoRow}>
              <Ionicons name="eye-off-outline" size={14} color={COLORS.textMuted} />
              <Text style={styles.infoSubtext}>Screenshots are monitored</Text>
            </View>
          )}
          {mediaData?.viewOnce && (
            <View style={styles.infoRow}>
              <Ionicons name="eye-outline" size={14} color={COLORS.textMuted} />
              <Text style={styles.infoSubtext}>View once — closes after viewing</Text>
            </View>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.95)',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingBottom: 8,
    zIndex: 10,
  },
  closeButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  timerBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: COLORS.primary,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
  },
  timerText: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.white,
  },
  reportButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.1)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  trustBanner: {
    alignItems: 'center',
    paddingVertical: 6,
  },
  trustRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  trustText: {
    fontSize: 12,
    fontWeight: '600',
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  loadingText: {
    fontSize: 14,
    color: COLORS.textMuted,
  },
  expiredContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  expiredText: {
    fontSize: 16,
    color: COLORS.textMuted,
  },
  expiredButton: {
    marginTop: 16,
    paddingHorizontal: 24,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: COLORS.primary,
  },
  expiredButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.white,
  },
  imageContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  blurWrapper: {
    width: SCREEN_WIDTH,
    height: SCREEN_HEIGHT * 0.65,
    position: 'relative',
  },
  image: {
    width: SCREEN_WIDTH,
    height: SCREEN_HEIGHT * 0.65,
  },
  blurOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.4)',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  blurText: {
    fontSize: 14,
    color: COLORS.white,
    textAlign: 'center',
    opacity: 0.8,
  },
  requestAccessButton: {
    marginTop: 8,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: COLORS.primary,
  },
  requestAccessText: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.primary,
  },
  accessRequestedText: {
    fontSize: 13,
    color: COLORS.textMuted,
    fontStyle: 'italic',
  },
  watermarkContainer: {
    ...StyleSheet.absoluteFillObject,
    overflow: 'hidden',
  },
  watermarkText: {
    position: 'absolute',
    fontSize: 18,
    fontWeight: '700',
    color: 'rgba(255,255,255,0.08)',
    left: 20,
    width: SCREEN_WIDTH * 1.5,
    textAlign: 'center',
  },
  footer: {
    paddingHorizontal: 20,
    gap: 4,
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  infoText: {
    fontSize: 13,
    color: COLORS.white,
    fontWeight: '500',
  },
  infoSubtext: {
    fontSize: 11,
    color: COLORS.textMuted,
  },
});
