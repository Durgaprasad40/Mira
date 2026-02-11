/**
 * Phase-2 protected media viewer.
 * Based on DemoProtectedMediaViewer but uses usePrivateChatStore.
 *
 * Timer logic:
 * - Subscribes to LIVE message from Zustand store (not stale prop)
 * - timerEndsAt is set in store ONCE on first open via markSecurePhotoViewed
 * - Timer persists across close/reopen - remaining time continues from stored timerEndsAt
 * - Interval reads timerEndsAt via ref to avoid stale closure issues
 *
 * Hold mode (Telegram-style):
 * - Bubble handles press-and-hold to open/close viewer
 * - Viewer just displays; closing is controlled by parent via visible prop
 */
import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  StatusBar,
  BackHandler,
  Platform,
} from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { INCOGNITO_COLORS } from '@/lib/constants';
import { usePrivateChatStore } from '@/stores/privateChatStore';

interface Phase2ProtectedMediaViewerProps {
  visible: boolean;
  conversationId: string;
  messageId: string;
  onClose: () => void;
}

// Module-level Set to track ONCE + HOLD messages that have been viewed.
// Persists across component unmounts to prevent re-viewing.
const viewedOnceHoldMessages = new Set<string>();

export function Phase2ProtectedMediaViewer({
  visible,
  conversationId,
  messageId,
  onClose,
}: Phase2ProtectedMediaViewerProps) {
  const insets = useSafeAreaInsets();
  const [timeLeft, setTimeLeft] = useState<number | null>(null);

  // Subscribe to LIVE message from Zustand store
  const message = usePrivateChatStore((s) => {
    const msgs = s.messages[conversationId];
    return msgs?.find((m) => m.id === messageId) ?? null;
  });

  // Store actions
  const markSecurePhotoViewed = usePrivateChatStore((s) => s.markSecurePhotoViewed);
  const markSecurePhotoExpired = usePrivateChatStore((s) => s.markSecurePhotoExpired);

  // Refs to avoid stale closures in interval
  const timerEndsAtRef = useRef<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const hasExpiredRef = useRef(false);
  const onCloseRef = useRef(onClose);

  // Keep refs up to date
  useEffect(() => {
    timerEndsAtRef.current = message?.timerEndsAt ?? null;
  }, [message?.timerEndsAt]);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  // Get message properties
  const timerSeconds = message?.protectedMedia?.timer ?? 0;
  const viewingMode = message?.protectedMedia?.viewingMode ?? 'tap';
  const isHoldMode = viewingMode === 'hold';
  const imageUri = message?.protectedMedia?.localUri;

  // ONCE view detection: timer === 0 means view once then expire
  const isOnce = timerSeconds === 0;

  // Track if photo was viewed this session (for ONCE expiration on close)
  const wasViewedThisSessionRef = useRef(false);

  // Clear interval helper
  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  // Handle close (close button or back gesture) - only for tap mode
  const handleClose = useCallback(() => {
    clearTimer();

    // ONCE view: expire immediately on close
    if (isOnce && !hasExpiredRef.current && message && !message.isExpired) {
      hasExpiredRef.current = true;
      markSecurePhotoExpired(conversationId, messageId);
    }

    onClose();
  }, [isOnce, message, conversationId, messageId, clearTimer, markSecurePhotoExpired, onClose]);

  // Android back button handler (only for tap mode)
  useEffect(() => {
    if (!visible || Platform.OS !== 'android' || isHoldMode) return;

    const backHandler = BackHandler.addEventListener('hardwareBackPress', () => {
      handleClose();
      return true;
    });

    return () => backHandler.remove();
  }, [visible, isHoldMode, handleClose]);

  // CRITICAL FIX: ONCE + HOLD must expire on FIRST release, block all subsequent holds.
  // Uses module-level Set to persist across component unmounts.
  useEffect(() => {
    if (!visible || !isOnce || !isHoldMode) return;

    // If already viewed in a previous hold, expire and close immediately
    if (viewedOnceHoldMessages.has(messageId)) {
      markSecurePhotoExpired(conversationId, messageId);
      onCloseRef.current();
      return;
    }

    // First hold - mark as viewed
    viewedOnceHoldMessages.add(messageId);

    // Cleanup: expire on release (component unmount)
    return () => {
      markSecurePhotoExpired(conversationId, messageId);
    };
  }, [visible, isOnce, isHoldMode, messageId, conversationId, markSecurePhotoExpired]);

  // SAFETY GUARD: If viewer opens but message is already expired, close immediately
  // This prevents any race condition from showing an expired photo
  useEffect(() => {
    if (visible && message?.isExpired) {
      onCloseRef.current();
    }
  }, [visible, message?.isExpired]);

  // Mark as viewed when viewer opens (for ONCE expiration tracking - tap mode)
  useEffect(() => {
    if (visible && message && !message.isExpired) {
      wasViewedThisSessionRef.current = true;
    }
  }, [visible, message]);

  // Handle close for TAP mode (button, back gesture)
  // ONCE + HOLD is handled by the dedicated effect above
  useEffect(() => {
    if (!visible && wasViewedThisSessionRef.current) {
      // ONCE + TAP: expire on close
      if (isOnce && !isHoldMode && !hasExpiredRef.current) {
        hasExpiredRef.current = true;
        markSecurePhotoExpired(conversationId, messageId);
      }

      // Reset session state
      wasViewedThisSessionRef.current = false;
      hasExpiredRef.current = false;
      setTimeLeft(null);
      clearTimer();
    }
  }, [visible, isOnce, isHoldMode, conversationId, messageId, clearTimer, markSecurePhotoExpired]);

  // Mark as viewed on first open (sets timerEndsAt in store ONCE)
  useEffect(() => {
    if (!visible || !message) return;
    if (message.isExpired) return;

    // Only set timerEndsAt if not already set
    if (!message.viewedAt && !message.timerEndsAt) {
      markSecurePhotoViewed(conversationId, messageId);
    }
  }, [visible, message, conversationId, messageId, markSecurePhotoViewed]);

  // Countdown timer - uses ref to read timerEndsAt (avoids stale closure)
  useEffect(() => {
    if (!visible || !message) return;

    // Already expired from store
    if (message.isExpired) {
      setTimeLeft(0);
      return;
    }

    // If timerEndsAt not set yet, wait for it
    if (!message.timerEndsAt) {
      if (timerSeconds === 0) {
        setTimeLeft(null);
      }
      return;
    }

    // Timer is set - start countdown using the ref
    const updateTimeLeft = () => {
      const endTime = timerEndsAtRef.current;
      if (!endTime) return;

      const now = Date.now();
      const remaining = Math.max(0, Math.ceil((endTime - now) / 1000));
      setTimeLeft(remaining);

      if (remaining <= 0 && !hasExpiredRef.current) {
        hasExpiredRef.current = true;
        clearTimer();
        markSecurePhotoExpired(conversationId, messageId);
        onCloseRef.current();
      }
    };

    updateTimeLeft();
    timerRef.current = setInterval(updateTimeLeft, 100);

    return () => clearTimer();
  }, [visible, message?.timerEndsAt, message?.isExpired, timerSeconds, conversationId, messageId, clearTimer, markSecurePhotoExpired]);

  // Cleanup on unmount
  useEffect(() => {
    return () => clearTimer();
  }, [clearTimer]);

  if (!visible || !message) return null;

  // Check if already expired
  if (message.isExpired) {
    return (
      <Modal visible={visible} transparent animationType="fade" statusBarTranslucent onRequestClose={handleClose}>
        <StatusBar hidden />
        <View style={styles.container}>
          <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
            <TouchableOpacity onPress={handleClose} style={styles.closeButton}>
              <Ionicons name="close" size={28} color={C.text} />
            </TouchableOpacity>
          </View>
          <View style={styles.expiredContainer}>
            <Ionicons name="lock-closed" size={48} color={C.textLight} />
            <Text style={styles.expiredText}>This media has expired</Text>
            <TouchableOpacity onPress={handleClose} style={styles.expiredButton}>
              <Text style={styles.expiredButtonText}>Go Back</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    );
  }

  const hasActiveTimer = timeLeft !== null && timeLeft > 0;

  return (
    <Modal visible={visible} transparent animationType="fade" statusBarTranslucent onRequestClose={handleClose}>
      <StatusBar hidden />
      <View style={styles.container}>
        {/* Photo layer - fullscreen */}
        {imageUri ? (
          <View style={StyleSheet.absoluteFill}>
            <Image
              source={{ uri: imageUri }}
              style={StyleSheet.absoluteFill}
              contentFit="contain"
            />
            {/* Corner countdown badge - only UI for timer */}
            {hasActiveTimer && (
              <View style={[styles.cornerBadge, { top: insets.top + 16 }]}>
                <Text style={styles.cornerBadgeText}>{timeLeft}</Text>
              </View>
            )}
          </View>
        ) : (
          <View style={styles.placeholder}>
            <Ionicons name="image-outline" size={64} color={C.textLight} />
            <Text style={styles.placeholderText}>Loading...</Text>
          </View>
        )}

        {/* Header overlay - close button only (no timer badge here) */}
        {!isHoldMode && (
          <View style={[styles.header, { paddingTop: insets.top + 8 }]} pointerEvents="box-none">
            <TouchableOpacity onPress={handleClose} style={styles.closeButton}>
              <Ionicons name="close" size={28} color={C.text} />
            </TouchableOpacity>
          </View>
        )}

        {/* Footer overlay - minimal info */}
        <View style={[styles.footer, { paddingBottom: insets.bottom + 16 }]} pointerEvents="none">
          <View style={styles.infoRow}>
            <Ionicons name="shield-checkmark" size={16} color={SOFT_ACCENT} />
            <Text style={styles.infoText}>Secure Photo</Text>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const C = INCOGNITO_COLORS;

// GOAL C: Softer accent color for Phase-2 (not harsh pink)
const SOFT_ACCENT = '#7B68A6';

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  header: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'flex-start',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingBottom: 8,
    zIndex: 10,
  },
  closeButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cornerBadge: {
    position: 'absolute',
    right: 16,
    backgroundColor: 'rgba(0,0,0,0.6)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 14,
  },
  cornerBadgeText: {
    fontSize: 16,
    fontWeight: '700',
    color: C.text,
  },
  expiredContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  expiredText: {
    fontSize: 16,
    color: C.textLight,
  },
  expiredButton: {
    marginTop: 16,
    paddingHorizontal: 24,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: SOFT_ACCENT,
  },
  expiredButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  placeholder: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  placeholderText: {
    fontSize: 18,
    fontWeight: '600',
    color: C.textLight,
  },
  footer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
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
    color: C.text,
    fontWeight: '500',
  },
});
