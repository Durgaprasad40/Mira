/*
 * LOCKED (PRIVATE DM ROUTE - ORPHANED)
 * Do NOT modify this file unless Durga Prasad explicitly unlocks it.
 *
 * STATUS:
 * - Feature is stable and production-locked
 * - No logic/UI changes allowed
 */

// ⚠️ ORPHANED ROUTE
// This route is currently unused.
// Private Chat uses modal inside [roomId].tsx.
// Keep for future reference — DO NOT NAVIGATE.

/**
 * Chat Room DM Route
 *
 * Renders a private DM conversation as a half-screen modal overlay.
 * The chat room remains visible behind (no dim overlay).
 *
 * KEYBOARD HANDLING:
 * - Android: Uses softwareKeyboardLayoutMode="resize" in app.json
 * - The system automatically resizes the window when keyboard opens
 * - NO manual keyboard handling needed - no KAV, no listeners, no dynamic height
 * - Sheet stays at fixed 55% height, system handles the rest
 *
 * @deprecated This route is orphaned. Private Chat now uses Modal in [roomId].tsx.
 */
import React, { useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Dimensions,
  TouchableWithoutFeedback,
  Platform,
  BackHandler,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import PrivateChatView from '@/components/chatroom/PrivateChatView';
import { useChatRoomDmStore } from '@/stores/chatRoomDmStore';
import { INCOGNITO_COLORS } from '@/lib/constants';

const C = INCOGNITO_COLORS;
const SCREEN_HEIGHT = Dimensions.get('window').height;
const SHEET_HEIGHT = SCREEN_HEIGHT * 0.55;

export default function ChatRoomDmScreen() {
  const router = useRouter();

  // P2 STABILITY: Warn in dev mode that this route is orphaned
  useEffect(() => {
    if (__DEV__) {
      console.warn('[ChatRoomDmScreen] Unused dm route mounted - Private Chat uses Modal in [roomId].tsx');
    }
  }, []);

  // Get active DM from store (set before navigation)
  const activeDm = useChatRoomDmStore((s) => s.activeDm);
  const clearActiveDm = useChatRoomDmStore((s) => s.clearActiveDm);

  // Handle back navigation - clears store and goes back to chat room
  const handleBack = useCallback(() => {
    clearActiveDm();
    router.back();
  }, [clearActiveDm, router]);

  // Handle backdrop tap - same as back
  const handleBackdropPress = useCallback(() => {
    handleBack();
  }, [handleBack]);

  // Android system back button/gesture should close the sheet
  useEffect(() => {
    if (Platform.OS !== 'android') return;

    const onBackPress = () => {
      handleBack();
      return true;
    };

    const subscription = BackHandler.addEventListener('hardwareBackPress', onBackPress);
    return () => subscription.remove();
  }, [handleBack]);

  // Fallback: If store is empty (e.g., deep link), show error
  if (!activeDm) {
    return (
      <View style={styles.container}>
        <TouchableWithoutFeedback onPress={handleBackdropPress}>
          <View style={styles.backdrop} />
        </TouchableWithoutFeedback>
        <View style={styles.sheet}>
          <View style={styles.handle} />
          <View style={styles.notFound}>
            <Ionicons name="alert-circle-outline" size={48} color={C.textLight} />
            <Text style={styles.notFoundText}>DM not found</Text>
            <Text style={styles.notFoundSubtext}>Please go back and try again</Text>
          </View>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Transparent backdrop - tap to dismiss */}
      <TouchableWithoutFeedback onPress={handleBackdropPress}>
        <View style={styles.backdrop} />
      </TouchableWithoutFeedback>

      {/* Sheet - FIXED height, system handles keyboard resize */}
      <View style={styles.sheet}>
        <View style={styles.content}>
          {/* Drag handle */}
          <View style={styles.handle} />

          {/* Chat content - no KAV needed, system resizes window */}
          <PrivateChatView
            dm={activeDm}
            onBack={handleBack}
            topInset={0}
            isModal={true}
            keyboardVisible={false}
          />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'transparent',
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'transparent',
  },
  sheet: {
    height: SHEET_HEIGHT,
    backgroundColor: C.background,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    overflow: 'hidden',
  },
  content: {
    flex: 1,
  },
  handle: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: C.accent,
    marginTop: 6,
    marginBottom: 2,
  },
  notFound: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 12,
  },
  notFoundText: {
    fontSize: 16,
    fontWeight: '600',
    color: C.textLight,
  },
  notFoundSubtext: {
    fontSize: 14,
    color: C.textLight,
    opacity: 0.7,
  },
});
