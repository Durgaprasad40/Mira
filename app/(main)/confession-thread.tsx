import React, { useState, useCallback, useMemo, useEffect } from 'react';
import {
  View,
  Text,
  FlatList,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  Alert,
  ActionSheetIOS,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useQuery, useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';
import EmojiPicker from 'rn-emoji-keyboard';
import * as Clipboard from 'expo-clipboard';
import { COLORS } from '@/lib/constants';
import { isProbablyEmoji } from '@/lib/utils';
import { Toast } from '@/components/ui/Toast';
import { ConfessionMood, ConfessionReply, ConfessionAuthorVisibility } from '@/types';
import ReactionBar from '@/components/confessions/ReactionBar';
import { useAuthStore } from '@/stores/authStore';
import { useConfessionStore } from '@/stores/confessionStore';
import { useBlockStore } from '@/stores/blockStore';
import { isDemoMode } from '@/hooks/useConvex';
import { asUserId, asConfessionId, asReplyId } from '@/convex/id';
import { shouldBlockConfessionOpen } from '@/lib/confessionsIntegrity';
import { logDebugEvent } from '@/lib/debugEventLogger';

// ============================================================================
// CONSTANTS
// ============================================================================

const MOOD_CONFIG: Record<ConfessionMood, { emoji: string; label: string; color: string; bg: string }> = {
  romantic: { emoji: '❤️', label: 'Romantic', color: '#E91E63', bg: 'rgba(233,30,99,0.12)' },
  spicy: { emoji: '🔥', label: 'Spicy', color: '#FF5722', bg: 'rgba(255,87,34,0.12)' },
  emotional: { emoji: '😢', label: 'Emotional', color: '#2196F3', bg: 'rgba(33,150,243,0.12)' },
  funny: { emoji: '😂', label: 'Funny', color: '#FF9800', bg: 'rgba(255,152,0,0.12)' },
};

const GENDER_LABELS: Record<string, string> = {
  male: 'M',
  female: 'F',
  non_binary: 'NB',
  lesbian: 'F',
  other: '',
};

// ============================================================================
// HELPERS
// ============================================================================

// P1-004 FIX: Guard against undefined/null timestamp (legacy data)
function getTimeAgo(timestamp: number | undefined | null): string {
  if (timestamp == null || !Number.isFinite(timestamp)) return 'just now';
  const diff = Date.now() - timestamp;
  if (diff < 0) return 'just now'; // Future timestamp protection
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export default function ConfessionThreadScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { confessionId } = useLocalSearchParams<{ confessionId: string }>();
  const { userId } = useAuthStore();

  // In live mode, never use demo fallback for Convex mutations
  const currentUserId = isDemoMode ? (userId || 'demo_user_1') : (userId || undefined);

  // ──────────────────────────────────────────────────────────────────────────
  // STORE SELECTORS (individual to avoid unnecessary re-renders)
  // ──────────────────────────────────────────────────────────────────────────
  const confessions = useConfessionStore((s) => s.confessions);
  const userReactions = useConfessionStore((s) => s.userReactions);
  const storeReplies = useConfessionStore((s) => s.replies);
  const toggleReaction = useConfessionStore((s) => s.toggleReaction);
  const reportConfession = useConfessionStore((s) => s.reportConfession);
  const addReplyToStore = useConfessionStore((s) => s.addReply);
  const deleteReplyFromStore = useConfessionStore((s) => s.deleteReply);
  const reportedIds = useConfessionStore((s) => s.reportedIds);
  const cleanupExpiredConfessions = useConfessionStore((s) => s.cleanupExpiredConfessions);
  const globalBlockedIds = useBlockStore((s) => s.blockedUserIds);

  // ──────────────────────────────────────────────────────────────────────────
  // CONVEX QUERIES
  // ──────────────────────────────────────────────────────────────────────────
  // P0-001 FIX: Use safe ID helper for route param
  const safeConfessionId = asConfessionId(confessionId);
  const convexConfession = useQuery(
    api.confessions.getConfession,
    !isDemoMode && safeConfessionId ? { confessionId: safeConfessionId } : 'skip'
  );

  const convexUserQueryArgs = !isDemoMode && currentUserId
    ? { userId: asUserId(currentUserId) ?? currentUserId }
    : 'skip';
  const convexCurrentUser = useQuery(api.users.getCurrentUser, convexUserQueryArgs);

  const convexReplies = useQuery(
    api.confessions.getReplies,
    !isDemoMode && safeConfessionId ? { confessionId: safeConfessionId } : 'skip'
  );

  // ──────────────────────────────────────────────────────────────────────────
  // DERIVED STATE: Effective User ID for ownership checks
  // ──────────────────────────────────────────────────────────────────────────
  const effectiveUserId = useMemo(() => {
    if (isDemoMode) return currentUserId;
    return convexCurrentUser?._id ?? undefined;
  }, [currentUserId, convexCurrentUser, isDemoMode]);

  // ──────────────────────────────────────────────────────────────────────────
  // DERIVED STATE: Confession data
  // ──────────────────────────────────────────────────────────────────────────
  const storeConfession = useMemo(
    () => confessions.find((c) => c.id === confessionId),
    [confessions, confessionId]
  );

  const confession = useMemo(() => {
    if (isDemoMode) return storeConfession;
    if (convexConfession) {
      return {
        id: convexConfession._id,
        odId: convexConfession._id,
        text: convexConfession.text,
        isAnonymous: convexConfession.isAnonymous,
        authorVisibility: convexConfession.authorVisibility as ConfessionAuthorVisibility | undefined,
        mood: convexConfession.mood as ConfessionMood,
        userId: convexConfession.userId,
        replyCount: convexConfession.replyCount || 0,
        reactionCount: convexConfession.reactionCount || 0,
        topEmojis: [],
        createdAt: convexConfession.createdAt,
        expiresAt: convexConfession.expiresAt,
        authorName: convexConfession.authorName,
        authorPhotoUrl: convexConfession.authorPhotoUrl,
        authorAge: convexConfession.authorAge,
        authorGender: convexConfession.authorGender,
      };
    }
    return undefined;
  }, [storeConfession, convexConfession]);

  const isLoadingConfession = !isDemoMode && convexConfession === undefined && !!confessionId;

  // ──────────────────────────────────────────────────────────────────────────
  // DERIVED STATE: Replies
  // ──────────────────────────────────────────────────────────────────────────
  const demoReplies = confessionId ? (storeReplies[confessionId] || []) : [];

  const replies: ConfessionReply[] = useMemo(() => {
    let items: ConfessionReply[];
    if (!isDemoMode && convexReplies) {
      items = convexReplies.map((r: any) => ({
        id: r._id,
        confessionId: r.confessionId,
        userId: r.userId,
        text: r.text,
        isAnonymous: r.isAnonymous,
        type: r.type || 'text',
        voiceUrl: r.voiceUrl,
        voiceDurationSec: r.voiceDurationSec,
        parentReplyId: r.parentReplyId, // Map parentReplyId for nested replies
        editedAt: r.editedAt,
        createdAt: r.createdAt,
      }));
    } else {
      items = demoReplies;
    }
    // Filter out replies from blocked users
    if (globalBlockedIds.length > 0) {
      items = items.filter((r) => !globalBlockedIds.includes(r.userId));
    }
    return items;
  }, [convexReplies, demoReplies, globalBlockedIds]);

  // ──────────────────────────────────────────────────────────────────────────
  // DERIVED STATE: Organized Replies (top-level + nested children)
  // ──────────────────────────────────────────────────────────────────────────
  // Top-level replies are those WITHOUT a parentReplyId
  const topLevelReplies = useMemo(() => {
    return replies.filter((r) => !r.parentReplyId);
  }, [replies]);

  // Map of parentReplyId -> child replies for quick lookup
  const childRepliesMap = useMemo(() => {
    const map: Record<string, ConfessionReply[]> = {};
    for (const r of replies) {
      if (r.parentReplyId) {
        if (!map[r.parentReplyId]) {
          map[r.parentReplyId] = [];
        }
        map[r.parentReplyId].push(r);
      }
    }
    // Sort children by createdAt ascending (oldest first)
    for (const key of Object.keys(map)) {
      map[key].sort((a, b) => a.createdAt - b.createdAt);
    }
    return map;
  }, [replies]);

  // Top-level reply count (for display - excludes nested replies)
  const topLevelReplyCount = topLevelReplies.length;

  // ──────────────────────────────────────────────────────────────────────────
  // CENTRALIZED OWNERSHIP CHECKS
  // ──────────────────────────────────────────────────────────────────────────
  const isOwnConfession = useMemo(() => {
    if (!effectiveUserId || !confession) return false;
    return confession.userId === effectiveUserId;
  }, [effectiveUserId, confession]);

  // Helper to check if a reply belongs to current user
  const isOwnReply = useCallback((reply: ConfessionReply) => {
    if (!effectiveUserId) return false;
    return reply.userId === effectiveUserId;
  }, [effectiveUserId]);

  // Helper to check if current user is the confession author (for plus button logic)
  const isConfessionAuthor = useMemo(() => {
    if (!effectiveUserId || !confession) return false;
    return confession.userId === effectiveUserId;
  }, [effectiveUserId, confession]);

  // Helper to check if a reply is from the OP
  const isReplyFromOP = useCallback((reply: ConfessionReply) => {
    if (!confession) return false;
    return reply.userId === confession.userId;
  }, [confession]);

  // Check if current user is the tagged user (for Reject/Connect actions)
  // Note: taggedUserId may be stripped from anonymous confessions for privacy,
  // but is still present on the backend for verification
  const isTaggedUser = useMemo(() => {
    if (!effectiveUserId || !convexConfession) return false;
    const taggedUserId = (convexConfession as any).taggedUserId;
    return taggedUserId === effectiveUserId;
  }, [effectiveUserId, convexConfession]);

  // Get the tagged user response status from backend
  const taggedUserResponse = useMemo(() => {
    if (!convexConfession) return null;
    return (convexConfession as any).taggedUserResponse ?? null;
  }, [convexConfession]);

  // Get the author response status from backend (for two-step flow)
  const authorResponse = useMemo(() => {
    if (!convexConfession) return null;
    return (convexConfession as any).authorResponse ?? null;
  }, [convexConfession]);

  // Get the tagged user ID for match celebration navigation
  const taggedUserId = useMemo(() => {
    if (!convexConfession) return null;
    return (convexConfession as any).taggedUserId ?? null;
  }, [convexConfession]);

  // ──────────────────────────────────────────────────────────────────────────
  // LOCAL STATE
  // ──────────────────────────────────────────────────────────────────────────
  const [replyText, setReplyText] = useState('');
  const [sending, setSending] = useState(false);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [showReactionPicker, setShowReactionPicker] = useState(false);
  const [replyingToReplyId, setReplyingToReplyId] = useState<string | null>(null);
  const [replyToReplyText, setReplyToReplyText] = useState('');
  const [guardTriggered, setGuardTriggered] = useState(false);
  // State for Reject/Connect actions (tagged user only)
  const [responding, setResponding] = useState(false);
  const [respondAction, setRespondAction] = useState<'reject' | 'connect' | null>(null);
  // State for author's response (two-step flow)
  const [authorResponding, setAuthorResponding] = useState(false);
  const [authorRespondAction, setAuthorRespondAction] = useState<'reject' | 'connect' | null>(null);
  // State for editing replies
  const [editingReplyId, setEditingReplyId] = useState<string | null>(null);
  const [editingReplyText, setEditingReplyText] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);

  // ──────────────────────────────────────────────────────────────────────────
  // NAVIGATION GUARD: Block expired/reported confessions
  // ──────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (guardTriggered || !confessionId || isLoadingConfession) return;

    const blockReason = shouldBlockConfessionOpen(
      confessionId,
      confession ? [confession as any] : [],
      globalBlockedIds,
      reportedIds,
    );

    if (blockReason && blockReason !== 'not_found') {
      setGuardTriggered(true);
      logDebugEvent('CHAT_EXPIRED', `Confession thread blocked: ${blockReason}`);
      if (blockReason === 'expired') {
        cleanupExpiredConfessions([confessionId]);
      }
      router.back();
    }
  }, [confessionId, confession, globalBlockedIds, reportedIds, guardTriggered, router, cleanupExpiredConfessions, isLoadingConfession]);

  // ──────────────────────────────────────────────────────────────────────────
  // CONVEX MUTATIONS
  // ──────────────────────────────────────────────────────────────────────────
  const createReplyMutation = useMutation(api.confessions.createReply);
  const deleteReplyMutation = useMutation(api.confessions.deleteReply);
  const editReplyMutation = useMutation(api.confessions.editReply);
  const reportReplyMutation = useMutation(api.confessions.reportReply);
  const reportMutation = useMutation(api.confessions.reportConfession);
  const toggleReactionMutation = useMutation(api.confessions.toggleReaction);
  const respondToTaggedConfessionMutation = useMutation(api.confessions.respondToTaggedConfession);
  const authorRespondToConnectMutation = useMutation(api.confessions.authorRespondToConnect);

  // ──────────────────────────────────────────────────────────────────────────
  // HANDLERS
  // ──────────────────────────────────────────────────────────────────────────
  const handleSendReply = useCallback(async () => {
    if (!replyText.trim() || !confessionId || sending || !currentUserId) return;

    const submittedText = replyText.trim();
    const newReply: ConfessionReply = {
      id: `cr_new_${Date.now()}`,
      confessionId,
      userId: currentUserId,
      text: submittedText,
      isAnonymous: true,
      type: 'text',
      createdAt: Date.now(),
    };

    addReplyToStore(confessionId, newReply);
    setReplyText('');
    setSending(true);

    if (!isDemoMode && safeConfessionId) {
      const safeUserId = asUserId(currentUserId);
      if (!safeUserId) return setSending(false);
      try {
        await createReplyMutation({
          confessionId: safeConfessionId,
          userId: safeUserId,
          text: submittedText,
          isAnonymous: true,
          type: 'text',
        });
      } catch {
        Toast.show("Couldn't send reply. Please try again.");
        deleteReplyFromStore(confessionId, newReply.id);
        setReplyText(submittedText);
      }
    }
    setSending(false);
  }, [replyText, confessionId, currentUserId, createReplyMutation, sending, addReplyToStore, deleteReplyFromStore, safeConfessionId]);

  const handleSendReplyToReply = useCallback(async (parentReplyIdArg: string) => {
    if (!replyToReplyText.trim() || !confessionId || sending || !currentUserId) return;

    const submittedText = replyToReplyText.trim();
    const newReply: ConfessionReply = {
      id: `cr_rtr_${Date.now()}`,
      confessionId,
      userId: currentUserId,
      text: submittedText,
      isAnonymous: false,
      type: 'text',
      parentReplyId: parentReplyIdArg, // Include parentReplyId for nested replies
      createdAt: Date.now(),
    };

    addReplyToStore(confessionId, newReply);
    setReplyToReplyText('');
    setReplyingToReplyId(null);
    setSending(true);

    if (!isDemoMode && safeConfessionId) {
      const safeUserId = asUserId(currentUserId);
      const safeParentReplyId = asReplyId(parentReplyIdArg);
      if (!safeUserId) return setSending(false);
      try {
        await createReplyMutation({
          confessionId: safeConfessionId,
          userId: safeUserId,
          text: submittedText,
          isAnonymous: false,
          type: 'text',
          parentReplyId: safeParentReplyId ?? undefined,
        });
      } catch {
        Toast.show("Couldn't send reply. Please try again.");
        deleteReplyFromStore(confessionId, newReply.id);
        setReplyToReplyText(submittedText);
      }
    }
    setSending(false);
  }, [replyToReplyText, confessionId, currentUserId, createReplyMutation, sending, addReplyToStore, deleteReplyFromStore, safeConfessionId]);

  const handleDeleteReply = useCallback(async (reply: ConfessionReply) => {
    if (reply.userId !== currentUserId || !confessionId) return;

    Alert.alert('Delete Reply', 'Are you sure you want to delete this reply?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          deleteReplyFromStore(confessionId, reply.id);
          // P0-001 FIX: Use safe ID helpers
          const safeReplyId = asReplyId(reply.id);
          const safeUserId = asUserId(currentUserId);
          if (!isDemoMode && safeReplyId && safeUserId) {
            try {
              await deleteReplyMutation({
                replyId: safeReplyId,
                userId: safeUserId,
              });
            } catch {
              addReplyToStore(confessionId, reply);
              Toast.show("Couldn't delete reply. Please try again.");
            }
          }
        },
      },
    ]);
  }, [currentUserId, confessionId, deleteReplyMutation, deleteReplyFromStore, addReplyToStore]);

  // Handler for own reply menu (Edit/Delete)
  const handleReplyMenu = useCallback((reply: ConfessionReply) => {
    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          options: ['Edit', 'Delete', 'Cancel'],
          destructiveButtonIndex: 1,
          cancelButtonIndex: 2,
        },
        (buttonIndex) => {
          if (buttonIndex === 0) {
            // Edit
            setEditingReplyId(reply.id);
            setEditingReplyText(reply.text);
          } else if (buttonIndex === 1) {
            // Delete
            handleDeleteReply(reply);
          }
        }
      );
    } else {
      Alert.alert('Reply Options', undefined, [
        {
          text: 'Edit',
          onPress: () => {
            setEditingReplyId(reply.id);
            setEditingReplyText(reply.text);
          },
        },
        { text: 'Delete', style: 'destructive', onPress: () => handleDeleteReply(reply) },
        { text: 'Cancel', style: 'cancel' },
      ]);
    }
  }, [handleDeleteReply]);

  // Handler to save edited reply
  const handleSaveEdit = useCallback(async (reply: ConfessionReply) => {
    if (!editingReplyText.trim() || savingEdit || !currentUserId) return;

    const trimmedText = editingReplyText.trim();
    if (trimmedText === reply.text) {
      // No change, just cancel
      setEditingReplyId(null);
      setEditingReplyText('');
      return;
    }

    setSavingEdit(true);
    const safeReplyId = asReplyId(reply.id);
    const safeUserId = asUserId(currentUserId);

    if (!isDemoMode && safeReplyId && safeUserId) {
      try {
        await editReplyMutation({
          replyId: safeReplyId,
          userId: safeUserId,
          text: trimmedText,
        });
        Toast.show('Reply updated');
      } catch (e: any) {
        Toast.show(e?.message || "Couldn't update reply. Please try again.");
        setSavingEdit(false);
        return;
      }
    }

    // Update local store optimistically (for demo mode or after success)
    // Note: In live mode, Convex will auto-refresh via subscription
    setEditingReplyId(null);
    setEditingReplyText('');
    setSavingEdit(false);
  }, [editingReplyText, savingEdit, currentUserId, editReplyMutation]);

  // Handler for reporting other users' replies
  const handleReportReply = useCallback((reply: ConfessionReply) => {
    const reportReasons = [
      { key: 'spam', label: 'Spam' },
      { key: 'harassment', label: 'Abuse / Harassment' },
      { key: 'sexual', label: 'Vulgar / Sexual' },
      { key: 'hate', label: 'Hate / Offensive' },
      { key: 'other', label: 'Other' },
    ] as const;

    const submitReport = async (reason: typeof reportReasons[number]['key']) => {
      Toast.show('Report submitted');
      const safeReplyId = asReplyId(reply.id);
      const safeUserId = asUserId(currentUserId);
      if (!isDemoMode && safeReplyId && safeUserId) {
        try {
          await reportReplyMutation({
            replyId: safeReplyId,
            reporterId: safeUserId,
            reason,
          });
        } catch (e) {
          console.warn('[ReportReply] Backend fail:', e);
          Toast.show('Report may not have been saved');
        }
      }
    };

    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          title: 'Why are you reporting this reply?',
          options: [...reportReasons.map((r) => r.label), 'Cancel'],
          cancelButtonIndex: reportReasons.length,
        },
        (buttonIndex) => {
          if (buttonIndex < reportReasons.length) {
            submitReport(reportReasons[buttonIndex].key);
          }
        }
      );
    } else {
      Alert.alert('Report Reply', 'Why are you reporting this reply?', [
        ...reportReasons.map((r) => ({ text: r.label, onPress: () => submitReport(r.key) })),
        { text: 'Cancel', style: 'cancel' as const },
      ]);
    }
  }, [currentUserId, reportReplyMutation]);

  const handleReactEmoji = useCallback((emojiObj: any) => {
    if (!confession) return;
    const emoji = emojiObj.emoji;
    toggleReaction(confession.id, emoji);
    if (!isDemoMode && currentUserId) {
      toggleReactionMutation({
        confessionId: confession.id as any,
        userId: currentUserId as any,
        type: emoji,
      }).catch(() => {
        // P2-003 FIX: Rollback and show error feedback
        toggleReaction(confession.id, emoji);
        Toast.show('Reaction failed to save');
      });
    }
  }, [confession, toggleReaction, toggleReactionMutation, currentUserId]);

  const handleToggleEmoji = useCallback((emoji: string) => {
    if (!confession) return;
    toggleReaction(confession.id, emoji);
    if (!isDemoMode && currentUserId) {
      toggleReactionMutation({
        confessionId: confession.id as any,
        userId: currentUserId as any,
        type: emoji,
      }).catch(() => {
        // P2-003 FIX: Rollback and show error feedback
        toggleReaction(confession.id, emoji);
        Toast.show('Reaction failed to save');
      });
    }
  }, [confession, toggleReaction, toggleReactionMutation, currentUserId]);

  // Handler for tagged user Reject action
  const handleReject = useCallback(async () => {
    if (!confession || !confessionId || !currentUserId || !isTaggedUser) return;
    if (responding) return; // Prevent double-taps

    if (!isDemoMode && safeConfessionId) {
      try {
        const convexId = asUserId(currentUserId);
        if (!convexId) return;
        setResponding(true);
        setRespondAction('reject');
        await respondToTaggedConfessionMutation({
          confessionId: safeConfessionId,
          userId: convexId,
          action: 'reject',
        });
        Toast.show('Confession rejected');
      } catch (e: any) {
        Toast.show(e?.message || 'Could not reject. Please try again.');
      } finally {
        setResponding(false);
        setRespondAction(null);
      }
    }
  }, [confession, confessionId, currentUserId, isTaggedUser, responding, safeConfessionId, respondToTaggedConfessionMutation]);

  // Handler for tagged user Connect action
  const handleConnect = useCallback(async () => {
    if (!confession || !confessionId || !currentUserId || !isTaggedUser) return;
    if (responding) return; // Prevent double-taps

    if (!isDemoMode && safeConfessionId) {
      try {
        const convexId = asUserId(currentUserId);
        if (!convexId) return;
        setResponding(true);
        setRespondAction('connect');
        await respondToTaggedConfessionMutation({
          confessionId: safeConfessionId,
          userId: convexId,
          action: 'connect',
        });
        Toast.show('Interest sent! Waiting for their response.');
      } catch (e: any) {
        Toast.show(e?.message || 'Could not connect. Please try again.');
      } finally {
        setResponding(false);
        setRespondAction(null);
      }
    }
  }, [confession, confessionId, currentUserId, isTaggedUser, responding, safeConfessionId, respondToTaggedConfessionMutation]);

  // Handler for author Reject action (two-step flow - Step 2)
  const handleAuthorReject = useCallback(async () => {
    if (!confession || !confessionId || !currentUserId || !isOwnConfession) return;
    if (authorResponding) return; // Prevent double-taps

    if (!isDemoMode && safeConfessionId) {
      try {
        const convexId = asUserId(currentUserId);
        if (!convexId) return;
        setAuthorResponding(true);
        setAuthorRespondAction('reject');
        await authorRespondToConnectMutation({
          confessionId: safeConfessionId,
          userId: convexId,
          action: 'reject',
        });
        Toast.show('Connection declined');
      } catch (e: any) {
        Toast.show(e?.message || 'Could not decline. Please try again.');
      } finally {
        setAuthorResponding(false);
        setAuthorRespondAction(null);
      }
    }
  }, [confession, confessionId, currentUserId, isOwnConfession, authorResponding, safeConfessionId, authorRespondToConnectMutation]);

  // Handler for author Connect action (two-step flow - Step 2)
  const handleAuthorConnect = useCallback(async () => {
    if (!confession || !confessionId || !currentUserId || !isOwnConfession) return;
    if (authorResponding) return; // Prevent double-taps

    if (!isDemoMode && safeConfessionId) {
      try {
        const convexId = asUserId(currentUserId);
        if (!convexId) return;
        setAuthorResponding(true);
        setAuthorRespondAction('connect');
        const result = await authorRespondToConnectMutation({
          confessionId: safeConfessionId,
          userId: convexId,
          action: 'connect',
        });
        if (result.matchCreated && result.matchId && taggedUserId) {
          // Navigate to match celebration screen
          router.push(`/(main)/match-celebration?matchId=${result.matchId}&userId=${taggedUserId}` as any);
        } else {
          Toast.show('Connected!');
        }
      } catch (e: any) {
        Toast.show(e?.message || 'Could not connect. Please try again.');
      } finally {
        setAuthorResponding(false);
        setAuthorRespondAction(null);
      }
    }
  }, [confession, confessionId, currentUserId, isOwnConfession, authorResponding, safeConfessionId, authorRespondToConnectMutation, taggedUserId, router]);

  const handleReport = useCallback(() => {
    if (!confessionId) return;
    const reportReasons = [
      { key: 'spam', label: 'Spam' },
      { key: 'harassment', label: 'Harassment' },
      { key: 'hate', label: 'Hate Speech' },
      { key: 'sexual', label: 'Sexual/Inappropriate' },
      { key: 'other', label: 'Other' },
    ] as const;

    const submitReport = (reason: typeof reportReasons[number]['key']) => {
      reportConfession(confessionId);
      // P2-003 FIX: Show optimistic success feedback
      Toast.show('Report submitted');
      // P0-001 FIX: Use safe ID helpers
      const safeReporterId = asUserId(currentUserId);
      if (!isDemoMode && safeConfessionId && safeReporterId) {
        reportMutation({
          confessionId: safeConfessionId,
          reporterId: safeReporterId,
          reason,
        }).catch((e) => {
          // P2-003 FIX: Show error feedback if backend fails
          console.warn('[Report] Backend fail:', e);
          Toast.show('Report may not have been saved');
        });
      }
      router.back();
    };

    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          title: 'Why are you reporting this?',
          options: [...reportReasons.map((r) => r.label), 'Cancel'],
          cancelButtonIndex: reportReasons.length,
        },
        (buttonIndex) => {
          if (buttonIndex < reportReasons.length) {
            submitReport(reportReasons[buttonIndex].key);
          }
        }
      );
    } else {
      Alert.alert('Report Confession', 'Why are you reporting this?', [
        ...reportReasons.map((r) => ({ text: r.label, onPress: () => submitReport(r.key) })),
        { text: 'Cancel', style: 'cancel' as const },
      ]);
    }
  }, [confessionId, reportConfession, reportMutation, currentUserId, router]);

  const handleCopyText = useCallback(() => {
    if (!confession) return;
    Clipboard.setStringAsync(confession.text).catch(() => {});
  }, [confession]);

  const handleMenu = useCallback(() => {
    Alert.alert('Options', undefined, [
      { text: 'Copy Text', onPress: handleCopyText },
      { text: 'Report', style: 'destructive', onPress: handleReport },
      { text: 'Cancel', style: 'cancel' },
    ]);
  }, [handleCopyText, handleReport]);

  const handleEmojiSelected = useCallback((emoji: any) => {
    setReplyText((prev) => prev + emoji.emoji);
  }, []);

  // ──────────────────────────────────────────────────────────────────────────
  // LOADING/EMPTY STATE
  // ──────────────────────────────────────────────────────────────────────────
  if (!confession) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.navBar}>
          <TouchableOpacity onPress={() => router.back()} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
            <Ionicons name="arrow-back" size={24} color={COLORS.text} />
          </TouchableOpacity>
          <Text style={styles.navTitle}>Thread</Text>
          <View style={{ width: 24 }} />
        </View>
        <View style={styles.loadingContainer}>
          {isLoadingConfession ? (
            <>
              <ActivityIndicator size="large" color={COLORS.primary} />
              <Text style={styles.loadingText}>Loading...</Text>
            </>
          ) : (
            <>
              <Text style={styles.emptyEmoji}>💬</Text>
              <Text style={styles.emptyTitle}>Confession not found</Text>
              <Text style={styles.emptySubtitle}>It may have been removed or is no longer available.</Text>
            </>
          )}
        </View>
      </SafeAreaView>
    );
  }

  // ──────────────────────────────────────────────────────────────────────────
  // DERIVED DISPLAY VALUES
  // ──────────────────────────────────────────────────────────────────────────
  const badgeInfo = MOOD_CONFIG[confession.mood];
  const rawReaction = userReactions[confession.id] || null;
  const myReaction = rawReaction && isProbablyEmoji(rawReaction) ? rawReaction : null;
  const topEmojis = confession.topEmojis || [];

  // Determine effective visibility mode (backward compat: use isAnonymous if authorVisibility not set)
  const effectiveVisibility: ConfessionAuthorVisibility = (confession as any).authorVisibility || (confession.isAnonymous ? 'anonymous' : 'open');
  const isFullyAnonymous = effectiveVisibility === 'anonymous';
  const isBlurPhoto = effectiveVisibility === 'blur_photo';

  const getDisplayName = (): string => {
    if (isFullyAnonymous) return 'Anonymous';
    const authorName = (confession as any).authorName;
    if (!authorName) return 'Someone';
    let name = authorName;
    const authorAge = (confession as any).authorAge;
    const authorGender = (confession as any).authorGender;
    if (authorAge) name += `, ${authorAge}`;
    if (authorGender && GENDER_LABELS[authorGender]) name += ` ${GENDER_LABELS[authorGender]}`;
    return name;
  };

  const displayName = getDisplayName();
  const authorPhotoUrl = !isFullyAnonymous ? (confession as any).authorPhotoUrl : null;

  // Whether to show bottom composer (hidden for OP viewing own confession)
  const showBottomComposer = !isOwnConfession;

  // ──────────────────────────────────────────────────────────────────────────
  // RENDER: Reply Item
  // ──────────────────────────────────────────────────────────────────────────
  const renderReplyItem = ({ item }: { item: ConfessionReply }) => {
    const replyIsOwn = isOwnReply(item);
    const replyIsFromOP = isReplyFromOP(item);
    // Plus button: only for confession author, only on OTHER users' replies
    const showPlusButton = isConfessionAuthor && !replyIsOwn;
    const isReplyingToThis = replyingToReplyId === item.id;
    const isEditingThis = editingReplyId === item.id;
    // Show report button for other users' replies (not own, not when OP has plus button)
    const showReportButton = !replyIsOwn && !showPlusButton;

    return (
      <View style={styles.replyCard}>
        <View>
          <View style={styles.replyHeader}>
            <View style={[styles.replyAvatar, item.isAnonymous && styles.avatarAnonymous]}>
              <Ionicons
                name={item.isAnonymous ? 'eye-off' : 'person'}
                size={12}
                color={item.isAnonymous ? COLORS.textMuted : COLORS.primary}
              />
            </View>
            <Text style={styles.replyAuthor}>
              {item.isAnonymous ? 'Anonymous' : 'Someone'}
            </Text>
            {replyIsFromOP && (
              <View style={styles.opBadge}>
                <Text style={styles.opBadgeText}>OP</Text>
              </View>
            )}
            {item.type === 'voice' && (
              <View style={styles.voiceBadge}>
                <Ionicons name="mic" size={10} color={COLORS.primary} />
              </View>
            )}
            {/* Show "(edited)" indicator if reply was edited */}
            {(item as any).editedAt && (
              <Text style={styles.editedIndicator}>(edited)</Text>
            )}
            <Text style={styles.replyTime}>{getTimeAgo(item.createdAt)}</Text>

            {/* Three-dots menu for own replies (Edit/Delete) */}
            {replyIsOwn && !isEditingThis && (
              <TouchableOpacity
                onPress={() => handleReplyMenu(item)}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                style={styles.menuButton}
              >
                <Ionicons name="ellipsis-vertical" size={16} color={COLORS.textMuted} />
              </TouchableOpacity>
            )}

            {/* Report button for other users' replies */}
            {showReportButton && (
              <TouchableOpacity
                onPress={() => handleReportReply(item)}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                style={styles.reportButton}
              >
                <Ionicons name="flag-outline" size={14} color={COLORS.textMuted} />
              </TouchableOpacity>
            )}

            {/* Plus button for OP to reply to other users' replies */}
            {showPlusButton && (
              <TouchableOpacity
                onPress={() => {
                  if (isReplyingToThis) {
                    setReplyingToReplyId(null);
                    setReplyToReplyText('');
                  } else {
                    setReplyingToReplyId(item.id);
                    setReplyToReplyText('');
                  }
                }}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                style={styles.plusButton}
              >
                <Ionicons
                  name={isReplyingToThis ? 'close-circle' : 'add-circle-outline'}
                  size={20}
                  color={isReplyingToThis ? COLORS.textMuted : COLORS.primary}
                />
              </TouchableOpacity>
            )}
          </View>

          {/* Reply text or inline edit input */}
          {isEditingThis ? (
            <View style={styles.editContainer}>
              <TextInput
                style={styles.editInput}
                value={editingReplyText}
                onChangeText={setEditingReplyText}
                maxLength={300}
                multiline
                autoFocus
                placeholder="Edit your reply..."
                placeholderTextColor={COLORS.textMuted}
              />
              <View style={styles.editActions}>
                <TouchableOpacity
                  style={styles.editCancelButton}
                  onPress={() => {
                    setEditingReplyId(null);
                    setEditingReplyText('');
                  }}
                >
                  <Text style={styles.editCancelText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    styles.editSaveButton,
                    (!editingReplyText.trim() || savingEdit) && styles.buttonDisabled,
                  ]}
                  onPress={() => handleSaveEdit(item)}
                  disabled={!editingReplyText.trim() || savingEdit}
                >
                  {savingEdit ? (
                    <ActivityIndicator size="small" color={COLORS.white} />
                  ) : (
                    <Text style={styles.editSaveText}>Save</Text>
                  )}
                </TouchableOpacity>
              </View>
            </View>
          ) : (
            <Text style={styles.replyText}>
              {item.type === 'voice' ? `🎙️ Voice reply (${item.voiceDurationSec || 0}s)` : item.text}
            </Text>
          )}
        </View>

        {/* Inline composer for OP reply-to-reply */}
        {isReplyingToThis && (
          <View style={styles.inlineComposer}>
            <TextInput
              style={styles.inlineInput}
              placeholder="Reply to this..."
              placeholderTextColor={COLORS.textMuted}
              value={replyToReplyText}
              onChangeText={setReplyToReplyText}
              maxLength={200}
              autoFocus
            />
            <TouchableOpacity
              style={[styles.inlineSendButton, (!replyToReplyText.trim() || sending) && styles.buttonDisabled]}
              onPress={() => handleSendReplyToReply(item.id)}
              disabled={!replyToReplyText.trim() || sending}
            >
              <Ionicons
                name="send"
                size={14}
                color={replyToReplyText.trim() && !sending ? COLORS.white : COLORS.textMuted}
              />
            </TouchableOpacity>
          </View>
        )}

        {/* Nested child replies */}
        {childRepliesMap[item.id] && childRepliesMap[item.id].length > 0 && (
          <View style={styles.nestedRepliesContainer}>
            {childRepliesMap[item.id].map((childReply) => {
              const childIsOwn = isOwnReply(childReply);
              const childIsFromOP = isReplyFromOP(childReply);
              const isEditingChild = editingReplyId === childReply.id;

              return (
                <View key={childReply.id} style={styles.nestedReplyCard}>
                  <View style={styles.nestedReplyHeader}>
                    <View style={[styles.nestedReplyAvatar, childReply.isAnonymous && styles.avatarAnonymous]}>
                      <Ionicons
                        name={childReply.isAnonymous ? 'eye-off' : 'person'}
                        size={8}
                        color={childReply.isAnonymous ? COLORS.textMuted : COLORS.primary}
                      />
                    </View>
                    <Text style={styles.nestedReplyAuthor}>
                      {childReply.isAnonymous ? 'Anonymous' : 'Someone'}
                    </Text>
                    {childIsFromOP && (
                      <View style={styles.opBadgeSmall}>
                        <Text style={styles.opBadgeSmallText}>OP</Text>
                      </View>
                    )}
                    {childReply.editedAt && (
                      <Text style={styles.editedIndicator}>(edited)</Text>
                    )}
                    <Text style={styles.nestedReplyTime}>{getTimeAgo(childReply.createdAt)}</Text>

                    {/* Three-dots menu for own nested replies */}
                    {childIsOwn && !isEditingChild && (
                      <TouchableOpacity
                        onPress={() => handleReplyMenu(childReply)}
                        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                        style={styles.menuButton}
                      >
                        <Ionicons name="ellipsis-vertical" size={14} color={COLORS.textMuted} />
                      </TouchableOpacity>
                    )}

                    {/* Report button for other users' nested replies */}
                    {!childIsOwn && (
                      <TouchableOpacity
                        onPress={() => handleReportReply(childReply)}
                        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                        style={styles.reportButton}
                      >
                        <Ionicons name="flag-outline" size={12} color={COLORS.textMuted} />
                      </TouchableOpacity>
                    )}
                  </View>

                  {/* Nested reply text or inline edit */}
                  {isEditingChild ? (
                    <View style={styles.editContainer}>
                      <TextInput
                        style={styles.editInput}
                        value={editingReplyText}
                        onChangeText={setEditingReplyText}
                        maxLength={300}
                        multiline
                        autoFocus
                        placeholder="Edit your reply..."
                        placeholderTextColor={COLORS.textMuted}
                      />
                      <View style={styles.editActions}>
                        <TouchableOpacity
                          style={styles.editCancelButton}
                          onPress={() => {
                            setEditingReplyId(null);
                            setEditingReplyText('');
                          }}
                        >
                          <Text style={styles.editCancelText}>Cancel</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={[
                            styles.editSaveButton,
                            (!editingReplyText.trim() || savingEdit) && styles.buttonDisabled,
                          ]}
                          onPress={() => handleSaveEdit(childReply)}
                          disabled={!editingReplyText.trim() || savingEdit}
                        >
                          {savingEdit ? (
                            <ActivityIndicator size="small" color={COLORS.white} />
                          ) : (
                            <Text style={styles.editSaveText}>Save</Text>
                          )}
                        </TouchableOpacity>
                      </View>
                    </View>
                  ) : (
                    <Text style={styles.nestedReplyText}>
                      {childReply.type === 'voice'
                        ? `🎙️ Voice reply (${childReply.voiceDurationSec || 0}s)`
                        : childReply.text}
                    </Text>
                  )}
                </View>
              );
            })}
          </View>
        )}
      </View>
    );
  };

  // ──────────────────────────────────────────────────────────────────────────
  // RENDER: Confession Header (ListHeaderComponent)
  // ──────────────────────────────────────────────────────────────────────────
  // Blur radius constant for blur_photo mode
  const BLUR_PHOTO_RADIUS = 20;

  const renderConfessionHeader = () => (
    <View style={styles.confessionCard}>
      {/* Author row */}
      <View style={styles.confessionHeader}>
        <View style={styles.authorRow}>
          {/* Photo rendering based on visibility mode */}
          {isFullyAnonymous ? (
            // Anonymous: no photo, just icon
            <View style={[styles.avatar, styles.avatarAnonymous]}>
              <Ionicons name="eye-off" size={16} color={COLORS.textMuted} />
            </View>
          ) : isBlurPhoto && authorPhotoUrl ? (
            // Blur photo: show blurred image
            <Image
              source={{ uri: authorPhotoUrl }}
              style={styles.avatarImage}
              contentFit="cover"
              blurRadius={BLUR_PHOTO_RADIUS}
            />
          ) : authorPhotoUrl ? (
            // Open: show clear photo
            <Image source={{ uri: authorPhotoUrl }} style={styles.avatarImage} contentFit="cover" />
          ) : (
            // No photo available: show person icon
            <View style={styles.avatar}>
              <Ionicons name="person" size={16} color={COLORS.primary} />
            </View>
          )}
          <Text style={styles.authorName}>{displayName}</Text>
          {/* Blur indicator badge */}
          {isBlurPhoto && (
            <View style={styles.blurBadge}>
              <Ionicons name="eye-off-outline" size={10} color={COLORS.textMuted} />
            </View>
          )}
          <Text style={styles.timeAgo}>{getTimeAgo(confession.createdAt)}</Text>
        </View>
        <View style={[styles.moodBadge, { backgroundColor: badgeInfo.bg }]}>
          <Text style={styles.moodEmoji}>{badgeInfo.emoji}</Text>
          <Text style={[styles.moodLabel, { color: badgeInfo.color }]}>{badgeInfo.label}</Text>
        </View>
      </View>

      {/* Confession text */}
      <Text style={styles.confessionText}>{confession.text}</Text>

      {/* Reactions + Reply count */}
      <View style={styles.actionsRow}>
        <ReactionBar
          topEmojis={topEmojis}
          userEmoji={myReaction}
          reactionCount={confession.reactionCount}
          onReact={() => setShowReactionPicker(true)}
          onToggleEmoji={handleToggleEmoji}
          size="regular"
        />
        <View style={styles.replyCountBadge}>
          <Ionicons name="chatbubble-outline" size={12} color={COLORS.primary} />
          <Text style={styles.replyCountText}>
            {topLevelReplyCount} {topLevelReplyCount === 1 ? 'Reply' : 'Replies'}
          </Text>
        </View>
      </View>

      {/* Reject/Connect action block (tagged user only) */}
      {/* Hide block entirely once both connected (match already created) */}
      {isTaggedUser && !isOwnConfession && authorResponse !== 'connected' && (
        <View style={styles.taggedActionBlock}>
          <Text style={styles.taggedActionLabel}>Someone confessed to you</Text>
          {taggedUserResponse === 'rejected' ? (
            <View style={styles.respondedBadge}>
              <Ionicons name="close-circle" size={16} color={COLORS.textMuted} />
              <Text style={styles.respondedText}>Rejected</Text>
            </View>
          ) : taggedUserResponse === 'connected' ? (
            <View style={styles.respondedBadgeConnect}>
              <Ionicons name="hourglass-outline" size={16} color={COLORS.primary} />
              <Text style={styles.respondedTextConnect}>Waiting for their response...</Text>
            </View>
          ) : (
            <View style={styles.taggedActionButtons}>
              <TouchableOpacity
                style={[styles.rejectButton, responding && respondAction === 'reject' && styles.buttonLoading]}
                onPress={handleReject}
                disabled={responding}
              >
                {responding && respondAction === 'reject' ? (
                  <ActivityIndicator size="small" color={COLORS.textMuted} />
                ) : (
                  <>
                    <Ionicons name="close" size={18} color={COLORS.textMuted} />
                    <Text style={styles.rejectButtonText}>Reject</Text>
                  </>
                )}
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.connectButton, responding && respondAction === 'connect' && styles.buttonLoading]}
                onPress={handleConnect}
                disabled={responding}
              >
                {responding && respondAction === 'connect' ? (
                  <ActivityIndicator size="small" color={COLORS.white} />
                ) : (
                  <>
                    <Ionicons name="heart" size={18} color={COLORS.white} />
                    <Text style={styles.connectButtonText}>Connect</Text>
                  </>
                )}
              </TouchableOpacity>
            </View>
          )}
        </View>
      )}

      {/* Author action block - Two-Step Flow (author sees this when tagged user connects) */}
      {/* Hide block entirely once connected (match celebration handles navigation) */}
      {isOwnConfession && taggedUserResponse === 'connected' && authorResponse !== 'connected' && (
        <View style={styles.authorActionBlock}>
          {authorResponse === 'rejected' ? (
            <View style={styles.respondedBadge}>
              <Ionicons name="close-circle" size={16} color={COLORS.textMuted} />
              <Text style={styles.respondedText}>You declined this connection</Text>
            </View>
          ) : (
            <>
              <View style={styles.authorNotification}>
                <Ionicons name="notifications" size={18} color={COLORS.primary} />
                <Text style={styles.authorNotificationText}>Someone you tagged is open to connect</Text>
              </View>
              <View style={styles.taggedActionButtons}>
                <TouchableOpacity
                  style={[styles.rejectButton, authorResponding && authorRespondAction === 'reject' && styles.buttonLoading]}
                  onPress={handleAuthorReject}
                  disabled={authorResponding}
                >
                  {authorResponding && authorRespondAction === 'reject' ? (
                    <ActivityIndicator size="small" color={COLORS.textMuted} />
                  ) : (
                    <>
                      <Ionicons name="close" size={18} color={COLORS.textMuted} />
                      <Text style={styles.rejectButtonText}>Reject</Text>
                    </>
                  )}
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.connectButton, authorResponding && authorRespondAction === 'connect' && styles.buttonLoading]}
                  onPress={handleAuthorConnect}
                  disabled={authorResponding}
                >
                  {authorResponding && authorRespondAction === 'connect' ? (
                    <ActivityIndicator size="small" color={COLORS.white} />
                  ) : (
                    <>
                      <Ionicons name="heart" size={18} color={COLORS.white} />
                      <Text style={styles.connectButtonText}>Connect</Text>
                    </>
                  )}
                </TouchableOpacity>
              </View>
            </>
          )}
        </View>
      )}
    </View>
  );

  // ──────────────────────────────────────────────────────────────────────────
  // RENDER: Thread Footer
  // ──────────────────────────────────────────────────────────────────────────
  const renderThreadFooter = () => (
    <View style={styles.threadFooter}>
      <View style={styles.footerLine} />
      <Text style={styles.footerText}>
        {topLevelReplyCount === 0 ? 'No replies yet' : 'End of thread'}
      </Text>
      <View style={styles.footerLine} />
    </View>
  );

  // ──────────────────────────────────────────────────────────────────────────
  // MAIN RENDER
  // ──────────────────────────────────────────────────────────────────────────
  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      {/* Navigation Bar */}
      <View style={styles.navBar}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
          <Ionicons name="arrow-back" size={24} color={COLORS.text} />
        </TouchableOpacity>
        <Text style={styles.navTitle}>Thread</Text>
        <TouchableOpacity onPress={handleMenu} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
          <Ionicons name="ellipsis-vertical" size={20} color={COLORS.text} />
        </TouchableOpacity>
      </View>

      {/* Main Content Area */}
      <KeyboardAvoidingView
        style={styles.contentArea}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? insets.top : 0}
      >
        <FlatList
          data={topLevelReplies}
          keyExtractor={(item) => item.id}
          renderItem={renderReplyItem}
          ListHeaderComponent={renderConfessionHeader}
          ListFooterComponent={renderThreadFooter}
          contentContainerStyle={[
            styles.listContent,
            { paddingBottom: showBottomComposer ? 80 : 20 },
          ]}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        />

        {/* Bottom Composer (hidden for OP) */}
        {showBottomComposer && (
          <View style={[styles.bottomComposer, { paddingBottom: Math.max(insets.bottom, 12) }]}>
            <TouchableOpacity onPress={() => setShowEmojiPicker(true)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Text style={{ fontSize: 20 }}>🙂</Text>
            </TouchableOpacity>
            <TextInput
              style={styles.composerInput}
              placeholder="Reply anonymously..."
              placeholderTextColor={COLORS.textMuted}
              value={replyText}
              onChangeText={setReplyText}
              maxLength={300}
              multiline
            />
            <TouchableOpacity
              style={[styles.sendButton, (!replyText.trim() || sending) && styles.buttonDisabled]}
              onPress={handleSendReply}
              disabled={!replyText.trim() || sending}
            >
              <Ionicons
                name="send"
                size={18}
                color={replyText.trim() && !sending ? COLORS.white : COLORS.textMuted}
              />
            </TouchableOpacity>
          </View>
        )}
      </KeyboardAvoidingView>

      {/* Emoji Pickers */}
      <EmojiPicker
        onEmojiSelected={handleEmojiSelected}
        open={showEmojiPicker}
        onClose={() => setShowEmojiPicker(false)}
      />
      <EmojiPicker
        onEmojiSelected={handleReactEmoji}
        open={showReactionPicker}
        onClose={() => setShowReactionPicker(false)}
      />
    </SafeAreaView>
  );
}

// ============================================================================
// STYLES
// ============================================================================

const styles = StyleSheet.create({
  // ── Layout ──
  container: {
    flex: 1,
    backgroundColor: COLORS.white,
  },
  contentArea: {
    flex: 1,
    backgroundColor: COLORS.backgroundDark,
  },
  listContent: {
    flexGrow: 1,
  },

  // ── Navigation Bar ──
  navBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: COLORS.white,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.border,
  },
  navTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: COLORS.text,
  },

  // ── Loading/Empty State ──
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
    backgroundColor: COLORS.white,
  },
  loadingText: {
    fontSize: 16,
    color: COLORS.textMuted,
    marginTop: 12,
  },
  emptyEmoji: {
    fontSize: 56,
    marginBottom: 16,
  },
  emptyTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: COLORS.text,
    marginBottom: 8,
    textAlign: 'center',
  },
  emptySubtitle: {
    fontSize: 15,
    color: COLORS.textLight,
    textAlign: 'center',
    lineHeight: 22,
  },

  // ── Confession Card ──
  confessionCard: {
    backgroundColor: COLORS.white,
    padding: 16,
    marginBottom: 8,
  },
  confessionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 14,
  },
  authorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255,107,107,0.12)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarAnonymous: {
    backgroundColor: 'rgba(153,153,153,0.12)',
  },
  blurBadge: {
    marginLeft: 4,
    padding: 2,
    backgroundColor: 'rgba(153,153,153,0.15)',
    borderRadius: 4,
  },
  avatarImage: {
    width: 36,
    height: 36,
    borderRadius: 18,
  },
  authorName: {
    fontSize: 15,
    fontWeight: '600',
    color: COLORS.text,
  },
  timeAgo: {
    fontSize: 12,
    color: COLORS.textMuted,
  },
  moodBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    gap: 4,
  },
  moodEmoji: {
    fontSize: 12,
  },
  moodLabel: {
    fontSize: 11,
    fontWeight: '600',
  },
  confessionText: {
    fontSize: 16,
    lineHeight: 24,
    color: COLORS.text,
    marginBottom: 16,
  },
  actionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  replyCountBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    backgroundColor: 'rgba(255,107,107,0.1)',
  },
  replyCountText: {
    fontSize: 12,
    fontWeight: '600',
    color: COLORS.primary,
  },
  // Tagged user action block (Reject/Connect)
  taggedActionBlock: {
    marginTop: 12,
    padding: 14,
    backgroundColor: 'rgba(255,107,107,0.06)',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,107,107,0.15)',
  },
  taggedActionLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.text,
    marginBottom: 10,
    textAlign: 'center',
  },
  taggedActionButtons: {
    flexDirection: 'row',
    gap: 10,
  },
  rejectButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 24,
    backgroundColor: COLORS.backgroundDark,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  rejectButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.textMuted,
  },
  connectButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 24,
    backgroundColor: COLORS.primary,
  },
  connectButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.white,
  },
  buttonLoading: {
    opacity: 0.7,
  },
  respondedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 20,
    backgroundColor: COLORS.backgroundDark,
  },
  respondedText: {
    fontSize: 13,
    fontWeight: '500',
    color: COLORS.textMuted,
  },
  respondedBadgeConnect: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 20,
    backgroundColor: 'rgba(255,107,107,0.12)',
  },
  respondedTextConnect: {
    fontSize: 13,
    fontWeight: '500',
    color: COLORS.primary,
  },
  // Author action block (Two-Step Flow)
  authorActionBlock: {
    marginTop: 12,
    padding: 14,
    backgroundColor: 'rgba(76,175,80,0.08)',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(76,175,80,0.2)',
  },
  authorNotification: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginBottom: 12,
  },
  authorNotificationText: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.text,
    textAlign: 'center',
  },
  matchCreatedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 24,
    backgroundColor: COLORS.primary,
  },
  matchCreatedText: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.white,
  },

  // ── Reply Card ──
  replyCard: {
    backgroundColor: COLORS.white,
    marginHorizontal: 16,
    marginBottom: 4,
    borderRadius: 12,
    padding: 14,
  },
  replyHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  replyAvatar: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: 'rgba(255,107,107,0.12)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  replyAuthor: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.text,
  },
  opBadge: {
    backgroundColor: COLORS.primary,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  opBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: COLORS.white,
  },
  voiceBadge: {
    backgroundColor: 'rgba(255,107,107,0.1)',
    paddingHorizontal: 4,
    paddingVertical: 2,
    borderRadius: 6,
  },
  replyTime: {
    fontSize: 11,
    color: COLORS.textMuted,
    marginLeft: 'auto',
  },
  editedIndicator: {
    fontSize: 10,
    color: COLORS.textMuted,
    fontStyle: 'italic',
  },
  menuButton: {
    marginLeft: 4,
    padding: 4,
  },
  reportButton: {
    marginLeft: 4,
    padding: 4,
  },
  plusButton: {
    marginLeft: 8,
    padding: 4,
  },
  replyText: {
    fontSize: 14,
    lineHeight: 20,
    color: COLORS.text,
  },

  // ── Nested Replies (compact Instagram-style) ──
  nestedRepliesContainer: {
    marginTop: 6,
    marginLeft: 28, // Align with parent text, not avatar
    paddingLeft: 8,
    borderLeftWidth: 1.5,
    borderLeftColor: 'rgba(255,107,107,0.25)',
  },
  nestedReplyCard: {
    marginBottom: 4,
  },
  nestedReplyHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4, // Tighter than parent (8)
  },
  nestedReplyAvatar: {
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: 'rgba(255,107,107,0.1)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  nestedReplyAuthor: {
    fontSize: 11,
    fontWeight: '600',
    color: COLORS.text,
  },
  opBadgeSmall: {
    backgroundColor: COLORS.primary,
    paddingHorizontal: 3,
    paddingVertical: 0,
    borderRadius: 3,
  },
  opBadgeSmallText: {
    fontSize: 7,
    fontWeight: '700',
    color: COLORS.white,
  },
  nestedReplyTime: {
    fontSize: 9,
    color: COLORS.textMuted,
    marginLeft: 'auto',
  },
  nestedReplyText: {
    fontSize: 12,
    lineHeight: 16,
    color: COLORS.text,
    marginTop: 1,
    marginLeft: 20, // Align with author name, past avatar
  },

  // ── Edit Reply ──
  editContainer: {
    marginTop: 4,
  },
  editInput: {
    fontSize: 14,
    lineHeight: 20,
    color: COLORS.text,
    backgroundColor: COLORS.backgroundDark,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    minHeight: 60,
    maxHeight: 120,
    textAlignVertical: 'top',
  },
  editActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 8,
    marginTop: 8,
  },
  editCancelButton: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 16,
    backgroundColor: COLORS.backgroundDark,
  },
  editCancelText: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.textMuted,
  },
  editSaveButton: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 16,
    backgroundColor: COLORS.primary,
    minWidth: 60,
    alignItems: 'center',
  },
  editSaveText: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.white,
  },

  // ── Inline Composer (OP reply-to-reply) ──
  inlineComposer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: COLORS.border,
    gap: 8,
  },
  inlineInput: {
    flex: 1,
    fontSize: 13,
    color: COLORS.text,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: COLORS.backgroundDark,
    borderRadius: 16,
  },
  inlineSendButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: COLORS.primary,
    justifyContent: 'center',
    alignItems: 'center',
  },

  // ── Thread Footer ──
  threadFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    paddingHorizontal: 24,
    marginTop: 8,
  },
  footerLine: {
    flex: 1,
    height: StyleSheet.hairlineWidth,
    backgroundColor: COLORS.border,
  },
  footerText: {
    fontSize: 12,
    color: COLORS.textMuted,
    paddingHorizontal: 12,
    fontWeight: '500',
  },

  // ── Bottom Composer ──
  bottomComposer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    backgroundColor: COLORS.white,
    paddingHorizontal: 12,
    paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: COLORS.border,
    gap: 8,
  },
  composerInput: {
    flex: 1,
    fontSize: 15,
    color: COLORS.text,
    maxHeight: 80,
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: COLORS.backgroundDark,
    borderRadius: 20,
  },
  sendButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: COLORS.primary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  buttonDisabled: {
    backgroundColor: COLORS.border,
  },
});
