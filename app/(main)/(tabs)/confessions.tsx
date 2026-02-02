import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  RefreshControl,
  Alert,
  Animated,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '@/lib/constants';
import { ConfessionReactionType, ConfessionChat, ConfessionRevealPolicy, TimedRevealOption } from '@/types';
import { useAuthStore } from '@/stores/authStore';
import { useConfessionStore } from '@/stores/confessionStore';
import ConfessionCard from '@/components/confessions/ConfessionCard';
import ComposeConfessionModal from '@/components/confessions/ComposeConfessionModal';
import SecretCrushCard from '@/components/confessions/SecretCrushCard';
import ConfessionChatModal from '@/components/confessions/ConfessionChatModal';
import { useConfessionNotifications } from '@/hooks/useConfessionNotifications';

export default function ConfessionsScreen() {
  const router = useRouter();
  const { userId } = useAuthStore();
  const currentUserId = userId || 'demo_user_1';

  const {
    confessions,
    userReactions,
    secretCrushes,
    chats,
    seedConfessions,
    addConfession,
    toggleReaction,
    reportConfession,
    addChat,
    addChatMessage,
    revealCrush,
    agreeMutualReveal,
    declineMutualReveal,
    setTimedReveal,
  } = useConfessionStore();

  const { notifyReaction, notifyReply } = useConfessionNotifications();
  const [refreshing, setRefreshing] = useState(false);
  const [showCompose, setShowCompose] = useState(false);
  const [activeChatModal, setActiveChatModal] = useState<ConfessionChat | null>(null);
  const [showToast, setShowToast] = useState(false);
  const toastOpacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    seedConfessions();
  }, []);

  // Single feed — sorted by trending score (engagement), no categories
  const sortedConfessions = useMemo(() => {
    const list = [...confessions];
    list.sort((a, b) => {
      const scoreA = a.replyCount * 2 + a.reactionCount;
      const scoreB = b.replyCount * 2 + b.reactionCount;
      return scoreB - scoreA;
    });
    return list;
  }, [confessions]);

  const myCrushes = useMemo(
    () => secretCrushes.filter((sc) => sc.toUserId === currentUserId && !sc.isRevealed),
    [secretCrushes, currentUserId]
  );

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    setTimeout(() => setRefreshing(false), 800);
  }, []);

  const handleReact = useCallback(
    (confessionId: string, type: ConfessionReactionType) => {
      toggleReaction(confessionId, type);
      notifyReaction(confessionId);
    },
    [toggleReaction, notifyReaction]
  );

  const handleCompose = useCallback(
    (
      text: string,
      isAnonymous: boolean,
      _topic: any,
      targetUserId?: string,
      revealPolicy?: ConfessionRevealPolicy,
      timedReveal?: TimedRevealOption,
    ) => {
      const confessionId = `conf_new_${Date.now()}`;
      const newConfession = {
        id: confessionId,
        userId: currentUserId,
        text,
        isAnonymous: true, // always anonymous on feed
        mood: 'emotional' as const,
        reactions: { relatable: 0, feel_you: 0, bold: 0, curious: 0 } as Record<ConfessionReactionType, number>,
        targetUserId,
        visibility: 'global' as const,
        replyCount: 0,
        reactionCount: 0,
        createdAt: Date.now(),
        revealPolicy: revealPolicy || 'never',
      };
      addConfession(newConfession);

      // Set timed reveal if configured
      if (timedReveal && timedReveal !== 'never' && targetUserId) {
        setTimedReveal(confessionId, timedReveal, targetUserId);
      }

      if (targetUserId) {
        const { addSecretCrush } = useConfessionStore.getState();
        addSecretCrush({
          id: `sc_new_${Date.now()}`,
          fromUserId: currentUserId,
          toUserId: targetUserId,
          confessionText: text,
          isRevealed: false,
          createdAt: Date.now(),
          expiresAt: Date.now() + 1000 * 60 * 60 * 48,
        });
      }

      setShowCompose(false);

      // Show success toast
      setShowToast(true);
      Animated.sequence([
        Animated.timing(toastOpacity, { toValue: 1, duration: 250, useNativeDriver: true }),
        Animated.delay(1500),
        Animated.timing(toastOpacity, { toValue: 0, duration: 250, useNativeDriver: true }),
      ]).start(() => setShowToast(false));
    },
    [currentUserId, addConfession, setTimedReveal, toastOpacity]
  );

  const handleOpenThread = useCallback(
    (confessionId: string) => {
      router.push({
        pathname: '/(main)/confession-thread',
        params: { confessionId },
      } as any);
    },
    [router]
  );

  const handleReplyAnonymously = useCallback(
    (confessionId: string, confessionUserId: string) => {
      const existing = chats.find(
        (c) => c.confessionId === confessionId &&
          (c.initiatorId === currentUserId || c.responderId === currentUserId)
      );
      if (existing) {
        setActiveChatModal(existing);
        return;
      }

      const newChat: ConfessionChat = {
        id: `cc_new_${Date.now()}`,
        confessionId,
        initiatorId: currentUserId,
        responderId: confessionUserId,
        messages: [],
        isRevealed: false,
        createdAt: Date.now(),
        expiresAt: Date.now() + 1000 * 60 * 60 * 24,
        mutualRevealStatus: 'none',
      };
      addChat(newChat);
      setActiveChatModal(newChat);
      notifyReply(confessionId);
    },
    [chats, currentUserId, addChat, notifyReply]
  );

  const handleSendChatMessage = useCallback(
    (text: string) => {
      if (!activeChatModal) return;
      const message = {
        id: `ccm_new_${Date.now()}`,
        chatId: activeChatModal.id,
        senderId: currentUserId,
        text,
        createdAt: Date.now(),
      };
      addChatMessage(activeChatModal.id, message);
      setActiveChatModal((prev) =>
        prev ? { ...prev, messages: [...prev.messages, message] } : null
      );
    },
    [activeChatModal, currentUserId, addChatMessage]
  );

  const handleReport = useCallback(
    (confessionId: string) => {
      Alert.alert('Report Confession', 'Are you sure you want to report this confession?', [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Report',
          style: 'destructive',
          onPress: () => reportConfession(confessionId),
        },
      ]);
    },
    [reportConfession]
  );

  const handleRevealCrush = useCallback(
    (crushId: string) => {
      Alert.alert('Reveal Identity', 'Are you sure you want to reveal who sent this?', [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Reveal',
          onPress: () => revealCrush(crushId),
        },
      ]);
    },
    [revealCrush]
  );

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Compact header — matches T&D header pattern */}
      <View style={styles.header}>
        <Ionicons name="megaphone" size={16} color={COLORS.primary} />
        <Text style={styles.headerTitle}>Confess</Text>
      </View>

      {/* Single feed — no categories, no filters */}
      <FlatList
        data={sortedConfessions}
        keyExtractor={(item) => item.id}
        ListHeaderComponent={
          myCrushes.length > 0 ? (
            <View style={styles.crushSection}>
              {myCrushes.map((crush) => (
                <SecretCrushCard
                  key={crush.id}
                  crush={crush}
                  onReveal={() => handleRevealCrush(crush.id)}
                  onDismiss={() => revealCrush(crush.id)}
                />
              ))}
            </View>
          ) : null
        }
        renderItem={({ item }) => (
          <ConfessionCard
            id={item.id}
            text={item.text}
            isAnonymous={item.isAnonymous}
            mood={item.mood}
            reactions={item.reactions || { relatable: 0, feel_you: 0, bold: 0, curious: 0 }}
            userReactions={userReactions[item.id] || []}
            replyCount={item.replyCount}
            createdAt={item.createdAt}
            onPress={() => handleOpenThread(item.id)}
            onReact={(type) => handleReact(item.id, type)}
            onReplyAnonymously={() => handleReplyAnonymously(item.id, item.userId)}
            onReport={() => handleReport(item.id)}
          />
        )}
        contentContainerStyle={styles.listContent}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.primary} />
        }
        showsVerticalScrollIndicator={false}
      />

      {/* Success Toast */}
      {showToast && (
        <Animated.View style={[styles.toast, { opacity: toastOpacity }]}>
          <Ionicons name="checkmark-circle" size={18} color="#34C759" />
          <Text style={styles.toastText}>Posted anonymously</Text>
        </Animated.View>
      )}

      {/* FAB */}
      <TouchableOpacity
        style={styles.fab}
        onPress={() => setShowCompose(true)}
        activeOpacity={0.85}
      >
        <Ionicons name="add" size={24} color={COLORS.white} />
      </TouchableOpacity>

      {/* Compose Modal */}
      <ComposeConfessionModal
        visible={showCompose}
        onClose={() => setShowCompose(false)}
        onSubmit={handleCompose}
      />

      {/* Chat Modal */}
      <ConfessionChatModal
        visible={!!activeChatModal}
        chat={activeChatModal}
        currentUserId={currentUserId}
        confessionText={
          activeChatModal
            ? confessions.find((c) => c.id === activeChatModal.confessionId)?.text
            : undefined
        }
        onClose={() => setActiveChatModal(null)}
        onSendMessage={handleSendChatMessage}
        onAgreeReveal={() => {
          if (!activeChatModal) return;
          agreeMutualReveal(activeChatModal.id, currentUserId);
          // Refresh local modal state from store
          const updated = useConfessionStore.getState().chats.find((c) => c.id === activeChatModal.id);
          if (updated) setActiveChatModal({ ...updated });
        }}
        onDeclineReveal={() => {
          if (!activeChatModal) return;
          declineMutualReveal(activeChatModal.id, currentUserId);
          const updated = useConfessionStore.getState().chats.find((c) => c.id === activeChatModal.id);
          if (updated) setActiveChatModal({ ...updated });
        }}
        onBlock={() => {
          setActiveChatModal(null);
        }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.backgroundDark,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.border,
  },
  headerTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: COLORS.text,
  },
  crushSection: {
    marginBottom: 4,
  },
  listContent: {
    paddingTop: 4,
    paddingBottom: 96,
  },
  toast: {
    position: 'absolute',
    top: 56,
    left: 24,
    right: 24,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 12,
    backgroundColor: COLORS.white,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.12,
    shadowRadius: 8,
    elevation: 4,
    zIndex: 100,
  },
  toastText: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.text,
  },
  fab: {
    position: 'absolute',
    right: 16,
    bottom: 24,
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: COLORS.primary,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 6,
  },
});
