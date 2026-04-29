/*
 * Phase-2 Messages thread (clean rewrite).
 *
 * Replaces app/(main)/incognito-chat.tsx as the canonical Phase-2 chat thread.
 * Lives inside (private)/(tabs)/chats so the bottom Phase-2 tab bar stays
 * visible while the thread is open.
 *
 * Backend used (Phase-2 only):
 *   - api.privateConversations.getPrivateConversation
 *   - api.privateConversations.getPrivateMessages
 *   - api.privateConversations.sendPrivateMessage
 *   - api.privateConversations.markPrivateMessagesRead
 *   - api.users.getUserById                  (current user name resolution)
 *   - api.games.getBottleSpinSession         (T/D session state)
 *   - api.games.sendBottleSpinInvite
 *   - api.games.respondToBottleSpinInvite
 *   - api.games.endBottleSpinGame
 *
 * Behavior copied from Phase-1 ChatScreenInner:
 *   - autoAdvance={true} on BottleSpinGame
 *   - real currentUserName from api.users.getUserById (no hardcoded "You")
 *   - inline cooldown toast overlay (auto-hide after 3s)
 *   - modal close sets a local "paused" flag so auto-open does not re-trigger
 */
import React, {
  useState,
  useEffect,
  useCallback,
  useMemo,
  useRef,
} from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Modal,
} from 'react-native';
import { Image } from 'expo-image';
import { FlashList } from '@shopify/flash-list';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { useAuthStore } from '@/stores/authStore';
import { COLORS, INCOGNITO_COLORS } from '@/lib/constants';
import {
  MessageBubble,
  MessageInput,
  BottleSpinGame,
  TruthDareInviteCard,
} from '@/components/chat';

const C = INCOGNITO_COLORS;

type GameState = 'none' | 'pending' | 'active' | 'expired' | 'cooldown';

export default function Phase2ChatThread() {
  const router = useRouter();
  const params = useLocalSearchParams<{ id?: string | string[] }>();
  const id =
    typeof params.id === 'string' && params.id.trim()
      ? params.id.trim()
      : null;

  const userId = useAuthStore((s) => s.userId);
  const token = useAuthStore((s) => s.token);
  const insets = useSafeAreaInsets();

  // --------------------------------------------------------------------- queries
  const conversation = useQuery(
    api.privateConversations.getPrivateConversation,
    id && userId ? { conversationId: id as any, authUserId: userId } : 'skip'
  );

  const messages = useQuery(
    api.privateConversations.getPrivateMessages,
    id && userId
      ? { conversationId: id as any, authUserId: userId, limit: 100 }
      : 'skip'
  );

  const currentUser = useQuery(
    api.users.getUserById,
    userId ? { userId, viewerId: userId } : 'skip'
  );

  const gameSession = useQuery(
    api.games.getBottleSpinSession,
    id ? { conversationId: id } : 'skip'
  );

  // --------------------------------------------------------------------- mutations
  const sendPrivateMessage = useMutation(
    api.privateConversations.sendPrivateMessage
  );
  const markRead = useMutation(api.privateConversations.markPrivateMessagesRead);
  const sendInvite = useMutation(api.games.sendBottleSpinInvite);
  const respondInvite = useMutation(api.games.respondToBottleSpinInvite);

  // --------------------------------------------------------------------- local state
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [showGameModal, setShowGameModal] = useState(false);
  const [tdPaused, setTdPaused] = useState(false);
  const [showCooldownToast, setShowCooldownToast] = useState(false);
  const cooldownTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // --------------------------------------------------------------------- derived
  const otherUserId = (conversation as any)?.participantId as
    | string
    | undefined;
  const otherUserName =
    ((conversation as any)?.participantName as string | undefined) ??
    'Anonymous';
  const otherPhotoUrl = (conversation as any)?.participantPhotoUrl as
    | string
    | undefined;

  const tdState = ((gameSession as any)?.state as GameState | undefined) ??
    undefined;
  const inviterId = (gameSession as any)?.inviterId as string | undefined;
  const inviteeId = (gameSession as any)?.inviteeId as string | undefined;
  const amInviter = !!inviterId && inviterId === userId;
  const amInvitee = !!inviteeId && inviteeId === userId;

  const currentUserName = useMemo(() => {
    const u = currentUser as any;
    return (u?.name as string) || (u?.handle as string) || 'You';
  }, [currentUser]);

  // --------------------------------------------------------------------- logs
  useEffect(() => {
    console.log('[P2_THREAD_OPEN]', { id, userId });
  }, [id, userId]);

  useEffect(() => {
    if (gameSession === undefined) {
      console.log('[P2_TD_STATE] loading', { id });
    } else {
      console.log('[P2_TD_STATE]', {
        id,
        state: tdState,
        amInviter,
        amInvitee,
      });
    }
  }, [id, gameSession, tdState, amInviter, amInvitee]);

  // --------------------------------------------------------------------- side effects
  // Mark conversation as read whenever a new message arrives or thread mounts.
  useEffect(() => {
    if (!id || !token) return;
    markRead({ conversationId: id as any, token }).catch(() => {});
  }, [id, token, markRead, messages?.length]);

  // Auto-open game modal when game becomes active (unless user paused).
  useEffect(() => {
    if (!gameSession) return;
    if (tdState === 'active' && !tdPaused) {
      setShowGameModal(true);
    }
    if (tdState !== 'active' && showGameModal) {
      setShowGameModal(false);
    }
    // Reset pause flag once the session leaves active so the next active
    // session can auto-open again.
    if (tdState !== 'active' && tdPaused) {
      setTdPaused(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tdState, tdPaused]);

  // Cleanup cooldown timer on unmount.
  useEffect(() => {
    return () => {
      if (cooldownTimerRef.current) {
        clearTimeout(cooldownTimerRef.current);
        cooldownTimerRef.current = null;
      }
    };
  }, []);

  // --------------------------------------------------------------------- handlers
  const showCooldownFor3s = useCallback(() => {
    setShowCooldownToast(true);
    if (cooldownTimerRef.current) clearTimeout(cooldownTimerRef.current);
    cooldownTimerRef.current = setTimeout(() => {
      setShowCooldownToast(false);
      cooldownTimerRef.current = null;
    }, 3000);
  }, []);

  const handleTruthDarePress = useCallback(async () => {
    console.log('[P2_TD_PRESS]', {
      id,
      state: tdState,
      amInviter,
      amInvitee,
      userId,
    });

    if (!userId || !id) {
      console.log('[P2_TD] missing user or id', { currentUserId: userId, id });
      return;
    }

    if (gameSession === undefined) {
      console.log('[P2_TD] session loading', { id });
      Alert.alert('Loading game...', 'Please try again in a moment.');
      return;
    }

    // No session yet — open invite/cancel modal.
    if (!gameSession || tdState === 'none' || tdState === 'expired') {
      console.log('[P2_TD] opening invite modal');
      setTdPaused(false);
      setShowInviteModal(true);
      return;
    }

    if (tdState === 'pending') {
      if (amInvitee) {
        // Invitee taps T/D → show accept/decline card.
        setShowInviteModal(true);
      } else {
        Alert.alert('Invite sent', `Waiting for ${otherUserName} to respond.`);
      }
      return;
    }

    if (tdState === 'active') {
      setTdPaused(false);
      setShowGameModal(true);
      return;
    }

    if (tdState === 'cooldown') {
      showCooldownFor3s();
      return;
    }
  }, [
    id,
    tdState,
    amInviter,
    amInvitee,
    userId,
    gameSession,
    otherUserName,
    showCooldownFor3s,
  ]);

  const handleSendInvite = useCallback(async () => {
    if (!userId || !id || !otherUserId) {
      Alert.alert('Not ready', 'Cannot send invite right now.');
      return;
    }
    try {
      await sendInvite({
        authUserId: userId,
        conversationId: id,
        otherUserId,
      });
      console.log('[P2_TD_PRESS] invite sent');
      setShowInviteModal(false);
    } catch (err: any) {
      console.warn('[P2_TD_PRESS] invite failed:', err?.message ?? err);
      Alert.alert('Could not send invite', String(err?.message ?? err));
    }
  }, [userId, id, otherUserId, sendInvite]);

  const handleAcceptInvite = useCallback(async () => {
    if (!userId || !id) return;
    try {
      await respondInvite({
        authUserId: userId,
        conversationId: id,
        accept: true,
      });
      setShowInviteModal(false);
    } catch (err: any) {
      Alert.alert('Could not accept', String(err?.message ?? err));
    }
  }, [userId, id, respondInvite]);

  const handleDeclineInvite = useCallback(async () => {
    if (!userId || !id) return;
    try {
      await respondInvite({
        authUserId: userId,
        conversationId: id,
        accept: false,
      });
      setShowInviteModal(false);
    } catch (err: any) {
      Alert.alert('Could not decline', String(err?.message ?? err));
    }
  }, [userId, id, respondInvite]);

  const handleSendText = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || !id || !token) return;
      try {
        await sendPrivateMessage({
          token,
          conversationId: id as any,
          type: 'text',
          content: trimmed,
          clientMessageId: `${Date.now()}_${Math.random()
            .toString(36)
            .slice(2, 8)}`,
        });
      } catch (err: any) {
        Alert.alert('Send failed', String(err?.message ?? err));
      }
    },
    [id, token, sendPrivateMessage]
  );

  const handleSendResultMessage = useCallback(
    async (msg: string) => {
      if (!id || !token) return;
      try {
        await sendPrivateMessage({
          token,
          conversationId: id as any,
          type: 'system',
          content: msg,
        });
      } catch {
        // Non-fatal — system message failure shouldn't block the game.
      }
    },
    [id, token, sendPrivateMessage]
  );

  // --------------------------------------------------------------------- render helpers
  const renderItem = useCallback(
    ({ item }: { item: any }) => {
      const isOwn = item.senderId === userId;
      return (
        <View style={{ paddingHorizontal: 4 }}>
          <MessageBubble
            message={{
              id: String(item.id),
              senderId: item.senderId,
              type: item.type,
              content: item.content ?? '',
              createdAt: item.createdAt,
              deliveredAt: item.deliveredAt,
              readAt: item.readAt,
              imageUrl: item.imageUrl,
              audioUrl: item.audioUrl,
              audioDurationMs: item.audioDurationMs,
              isProtected: item.isProtected,
            }}
            isOwn={isOwn}
            otherUserName={otherUserName}
            currentUserId={userId ?? undefined}
            currentUserToken={token ?? undefined}
          />
        </View>
      );
    },
    [userId, token, otherUserName]
  );

  // --------------------------------------------------------------------- early-return: bad id
  if (!id) {
    return (
      <View style={[styles.errorContainer, { paddingTop: insets.top }]}>
        <Ionicons
          name="chatbubble-ellipses-outline"
          size={44}
          color={C.textLight}
        />
        <Text style={styles.errorTitle}>
          This conversation can’t be opened.
        </Text>
        <TouchableOpacity
          style={styles.errorBtn}
          onPress={() =>
            router.replace('/(main)/(private)/(tabs)/chats' as any)
          }
        >
          <Text style={styles.errorBtnText}>Go back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // --------------------------------------------------------------------- T/D button
  const tdButtonDisabled = !userId || !id;
  const tdIcon: keyof typeof Ionicons.glyphMap =
    tdState === 'cooldown'
      ? 'time-outline'
      : tdState === 'active'
        ? 'wine'
        : 'wine-outline';
  const tdIconColor =
    tdState === 'active' ? C.primary : tdButtonDisabled ? C.textLight : C.text;

  // --------------------------------------------------------------------- main
  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.headerBtn}
          onPress={() => router.back()}
        >
          <Ionicons name="chevron-back" size={26} color={C.text} />
        </TouchableOpacity>

        <View style={styles.headerInfo}>
          {otherPhotoUrl ? (
            <Image
              source={{ uri: otherPhotoUrl }}
              style={styles.headerAvatar}
              contentFit="cover"
            />
          ) : (
            <View style={[styles.headerAvatar, styles.headerAvatarFallback]}>
              <Ionicons name="person" size={18} color={C.textLight} />
            </View>
          )}
          <Text style={styles.headerName} numberOfLines={1}>
            {otherUserName}
          </Text>
        </View>

        <TouchableOpacity
          style={[
            styles.tdButton,
            tdButtonDisabled && styles.tdButtonDisabled,
          ]}
          onPress={handleTruthDarePress}
          disabled={tdButtonDisabled}
          activeOpacity={0.7}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Ionicons name={tdIcon} size={22} color={tdIconColor} />
        </TouchableOpacity>
      </View>

      {/* Inviter waiting strip */}
      {tdState === 'pending' && amInviter && (
        <View style={styles.waitingBar}>
          <ActivityIndicator size="small" color={C.primary} />
          <Text style={styles.waitingText}>
            Truth or Dare invite sent — waiting for {otherUserName}
          </Text>
        </View>
      )}

      {/* Cooldown toast */}
      {showCooldownToast && (
        <View
          style={[styles.cooldownToast, { top: insets.top + 64 }]}
          pointerEvents="none"
        >
          <Ionicons name="time-outline" size={16} color={COLORS.white} />
          <Text style={styles.cooldownText}>
            Truth or Dare is cooling down — try again in a bit
          </Text>
        </View>
      )}

      {/* Body: messages + composer */}
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={insets.top + 56}
      >
        <View style={styles.listWrap}>
          {messages === undefined ? (
            <View style={styles.loading}>
              <ActivityIndicator size="large" color={C.primary} />
            </View>
          ) : (messages?.length ?? 0) === 0 ? (
            <View style={styles.emptyState}>
              <Ionicons
                name="chatbubbles-outline"
                size={42}
                color={C.textLight}
              />
              <Text style={styles.emptyText}>
                Say hi to {otherUserName} to get started
              </Text>
            </View>
          ) : (
            <FlashList
              data={messages ?? []}
              keyExtractor={(item: any) => String(item.id)}
              renderItem={renderItem}
              contentContainerStyle={styles.listContent}
            />
          )}
        </View>

        <MessageInput onSend={handleSendText} />
      </KeyboardAvoidingView>

      {/* Invite modal — Send/Cancel for inviter, Accept/Decline for invitee */}
      <Modal
        visible={showInviteModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowInviteModal(false)}
      >
        <View style={styles.modalBackdrop}>
          {tdState === 'pending' && amInvitee ? (
            <View style={styles.inviteCardWrap}>
              <TruthDareInviteCard
                inviterName={otherUserName}
                isInvitee
                onAccept={handleAcceptInvite}
                onReject={handleDeclineInvite}
              />
              <TouchableOpacity
                style={styles.modalDismiss}
                onPress={() => setShowInviteModal(false)}
              >
                <Text style={styles.modalDismissText}>Close</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <View style={styles.inviteCard}>
              <View style={styles.inviteIconCircle}>
                <Ionicons name="wine" size={28} color={COLORS.white} />
              </View>
              <Text style={styles.inviteTitle}>Truth or Dare?</Text>
              <Text style={styles.inviteSubtitle}>
                Invite {otherUserName} to play. They’ll need to accept before
                the game starts.
              </Text>
              <View style={styles.inviteRow}>
                <TouchableOpacity
                  style={[styles.inviteBtn, styles.inviteCancel]}
                  onPress={() => setShowInviteModal(false)}
                >
                  <Text style={styles.inviteCancelText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.inviteBtn, styles.inviteSend]}
                  onPress={handleSendInvite}
                >
                  <Text style={styles.inviteSendText}>Send invite</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}
        </View>
      </Modal>

      {/* Bottle spin game — only mount when active */}
      {showGameModal && tdState === 'active' && id && userId && (
        <BottleSpinGame
          visible={showGameModal}
          onClose={() => setShowGameModal(false)}
          onCancel={() => {
            // TD-PAUSE parity: user-initiated close should NOT auto-reopen.
            setTdPaused(true);
            setShowGameModal(false);
          }}
          conversationId={id}
          userId={userId}
          currentUserName={currentUserName}
          otherUserName={otherUserName}
          onSendResultMessage={handleSendResultMessage}
          autoAdvance
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: C.border,
    backgroundColor: C.background,
  },
  headerBtn: { padding: 6 },
  headerInfo: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    minWidth: 0,
  },
  headerAvatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    marginLeft: 4,
    marginRight: 8,
  },
  headerAvatarFallback: {
    backgroundColor: C.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerName: {
    fontSize: 16,
    fontWeight: '600',
    color: C.text,
    flexShrink: 1,
  },
  tdButton: {
    padding: 8,
    borderRadius: 18,
    backgroundColor: C.surface,
    marginLeft: 8,
  },
  tdButtonDisabled: { opacity: 0.4 },
  waitingBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 8,
    backgroundColor: C.surface,
    gap: 8,
  },
  waitingText: { color: C.text, fontSize: 13, flexShrink: 1 },
  cooldownToast: {
    position: 'absolute',
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 8,
    backgroundColor: 'rgba(0,0,0,0.85)',
    borderRadius: 14,
    zIndex: 50,
    gap: 6,
  },
  cooldownText: { color: COLORS.white, fontSize: 13, fontWeight: '500' },
  listWrap: { flex: 1, backgroundColor: C.dmBackground ?? C.background },
  listContent: { paddingTop: 12, paddingBottom: 12 },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    gap: 10,
  },
  emptyText: { color: C.textLight, fontSize: 14, textAlign: 'center' },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  inviteCard: {
    width: '100%',
    maxWidth: 360,
    backgroundColor: COLORS.background,
    borderRadius: 16,
    padding: 20,
    alignItems: 'center',
  },
  inviteIconCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: C.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  inviteTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: COLORS.text,
    marginBottom: 6,
  },
  inviteSubtitle: {
    fontSize: 14,
    color: COLORS.textLight,
    textAlign: 'center',
    marginBottom: 16,
  },
  inviteRow: { flexDirection: 'row', gap: 12, width: '100%' },
  inviteBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  inviteCancel: { backgroundColor: '#E5E5EA' },
  inviteCancelText: { color: COLORS.text, fontWeight: '600' },
  inviteSend: { backgroundColor: C.primary },
  inviteSendText: { color: COLORS.white, fontWeight: '600' },
  inviteCardWrap: { width: '100%', maxWidth: 380, alignItems: 'center' },
  modalDismiss: { marginTop: 14, padding: 10 },
  modalDismissText: { color: COLORS.white, fontSize: 14, fontWeight: '500' },
  errorContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
    backgroundColor: C.background,
  },
  errorTitle: {
    color: C.text,
    fontSize: 16,
    fontWeight: '600',
    marginTop: 12,
    marginBottom: 16,
    textAlign: 'center',
  },
  errorBtn: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    backgroundColor: C.primary,
    borderRadius: 22,
  },
  errorBtnText: { color: COLORS.white, fontWeight: '600' },
});
