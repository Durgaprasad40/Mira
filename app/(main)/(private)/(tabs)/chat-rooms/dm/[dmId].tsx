/**
 * Chat Room DM Route
 *
 * Renders a private DM conversation as a proper route on the navigation stack.
 * This ensures swipe-back gesture returns to the chat room, not the room list.
 */
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import PrivateChatView from '@/components/chatroom/PrivateChatView';
import { useChatRoomDmStore } from '@/stores/chatRoomDmStore';
import { INCOGNITO_COLORS } from '@/lib/constants';

const C = INCOGNITO_COLORS;

export default function ChatRoomDmScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  // Get active DM from store (set before navigation)
  const activeDm = useChatRoomDmStore((s) => s.activeDm);
  const clearActiveDm = useChatRoomDmStore((s) => s.clearActiveDm);

  // Handle back navigation - clears store and goes back to chat room
  const handleBack = () => {
    clearActiveDm();
    router.back();
  };

  // Fallback: If store is empty (e.g., deep link), show error
  if (!activeDm) {
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <View style={styles.notFound}>
          <Ionicons name="alert-circle-outline" size={48} color={C.textLight} />
          <Text style={styles.notFoundText}>DM not found</Text>
          <Text style={styles.notFoundSubtext}>Please go back and try again</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <PrivateChatView
        dm={activeDm}
        onBack={handleBack}
        topInset={insets.top}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: C.background,
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
