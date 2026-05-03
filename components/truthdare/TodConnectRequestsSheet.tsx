import React, { useMemo } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from 'convex/react';
import { api } from '@/convex/_generated/api';
import {
  TodConnectInboxRequest,
  TodConnectRequestCard,
} from '@/components/truthdare/TodConnectRequestCard';

const COLORS = {
  surface: '#141428',
  surfaceSoft: '#252545',
  coral: '#E94560',
  coralSoft: '#FF6B8A',
  textPrimary: '#F5F5F7',
  textMuted: '#6E6E82',
  border: 'rgba(255, 255, 255, 0.08)',
};

type TodConnectRequestsSheetProps = {
  visible: boolean;
  authUserId: string | null | undefined;
  focusRequestId?: string | null;
  onClose: () => void;
};

function getPendingLabel(count: number): string {
  if (count === 0) return 'All caught up';
  if (count === 1) return '1 prompt to review';
  return `${count} prompts to review`;
}

export function TodConnectRequestsSheet({
  visible,
  authUserId,
  focusRequestId,
  onClose,
}: TodConnectRequestsSheetProps) {
  const router = useRouter();
  const requests = useQuery(
    api.truthDare.getPendingTodConnectRequestInbox,
    visible && authUserId ? { authUserId } : 'skip'
  );

  const orderedRequests = useMemo(() => {
    const raw = (requests ?? []) as TodConnectInboxRequest[];
    if (!focusRequestId) return raw;
    return raw.slice().sort((a, b) => {
      if (a.requestId === focusRequestId) return -1;
      if (b.requestId === focusRequestId) return 1;
      return b.createdAt - a.createdAt;
    });
  }, [focusRequestId, requests]);

  const openChat = (conversationId: string) => {
    onClose();
    router.push(`/(main)/incognito-chat?id=${encodeURIComponent(conversationId)}` as any);
  };

  const openPrompt = (request: TodConnectInboxRequest) => {
    onClose();
    router.push({
      pathname: '/(main)/prompt-thread' as any,
      params: {
        promptId: request.promptId,
        source: 'tod_inbox',
        requestId: request.requestId,
        highlightAnswerId: request.answerId,
      },
    });
  };

  const isLoading = requests === undefined;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={() => {}}>
          <View style={styles.handle} />
          <View style={styles.header}>
            <View>
              <Text style={styles.title}>Connect requests</Text>
              <Text style={styles.subtitle}>{getPendingLabel(orderedRequests.length)}</Text>
            </View>
            <TouchableOpacity style={styles.closeButton} onPress={onClose} activeOpacity={0.8}>
              <Ionicons name="close" size={20} color={COLORS.textPrimary} />
            </TouchableOpacity>
          </View>

          {isLoading ? (
            <View style={styles.centerState}>
              <ActivityIndicator size="small" color={COLORS.coral} />
              <Text style={styles.centerText}>Loading requests...</Text>
            </View>
          ) : orderedRequests.length === 0 ? (
            <View style={styles.centerState}>
              <View style={styles.emptyIcon}>
                <Ionicons name="checkmark-done" size={27} color={COLORS.coralSoft} />
              </View>
              <Text style={styles.emptyTitle}>All caught up ✨</Text>
              <Text style={styles.centerText}>New Truth or Dare connects will show up here.</Text>
            </View>
          ) : (
            <FlatList
              data={orderedRequests}
              keyExtractor={(item) => item.requestId}
              contentContainerStyle={styles.listContent}
              renderItem={({ item }) => (
                <TodConnectRequestCard
                  request={item}
                  highlighted={item.requestId === focusRequestId}
                  onPress={openPrompt}
                  onOpenChat={openChat}
                />
              )}
            />
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.54)',
    justifyContent: 'flex-end',
  },
  sheet: {
    maxHeight: '60%',
    minHeight: 280,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingTop: 10,
    overflow: 'hidden',
  },
  handle: {
    width: 42,
    height: 4,
    borderRadius: 2,
    backgroundColor: COLORS.surfaceSoft,
    alignSelf: 'center',
    marginBottom: 12,
  },
  header: {
    paddingHorizontal: 18,
    paddingBottom: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  title: {
    color: COLORS.textPrimary,
    fontSize: 19,
    fontWeight: '900',
  },
  subtitle: {
    color: COLORS.textMuted,
    fontSize: 12,
    marginTop: 3,
    fontWeight: '700',
  },
  closeButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.surfaceSoft,
  },
  listContent: {
    padding: 16,
    paddingBottom: 24,
  },
  centerState: {
    minHeight: 200,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 28,
    gap: 10,
  },
  centerText: {
    color: COLORS.textMuted,
    fontSize: 13,
    textAlign: 'center',
  },
  emptyIcon: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: 'rgba(233, 69, 96, 0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyTitle: {
    color: COLORS.textPrimary,
    fontSize: 17,
    fontWeight: '800',
  },
});
