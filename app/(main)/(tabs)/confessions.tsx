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
  ActivityIndicator,
  Modal,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  Switch,
  Dimensions,
  TouchableWithoutFeedback,
  Keyboard,
  ActionSheetIOS,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { LoadingGuard } from '@/components/safety';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';
import EmojiPicker from 'rn-emoji-keyboard';
import * as Haptics from 'expo-haptics';

// Safe haptic feedback helpers (guarded for unsupported devices)
const triggerSuccessHaptic = () => {
  try {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  } catch {}
};
const triggerWarningHaptic = () => {
  try {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
  } catch {}
};
import { COLORS } from '@/lib/constants';
import { Image } from 'expo-image';
import { isProbablyEmoji } from '@/lib/utils';
import { isContentClean } from '@/lib/contentFilter';
import { ConfessionChat } from '@/types';
import { useAuthStore } from '@/stores/authStore';
import { useConfessionStore } from '@/stores/confessionStore';
import { useDemoStore } from '@/stores/demoStore';
import { useBlockStore } from '@/stores/blockStore';
import { useDemoDmStore } from '@/stores/demoDmStore';
import { isDemoMode } from '@/hooks/useConvex';
import { asUserId } from '@/convex/id';
import ConfessionCard from '@/components/confessions/ConfessionCard';
import SecretCrushCard from '@/components/confessions/SecretCrushCard';
import { useConfessionNotifications } from '@/hooks/useConfessionNotifications';
import { useConfessPreviewStore } from '@/stores/confessPreviewStore';
import { useScreenSafety } from '@/hooks/useScreenSafety';
import { logDebugEvent } from '@/lib/debugEventLogger';
import {
  processConfessionsIntegrity,
  buildDemoTaggedConfessions,
  computeConfessionBadgeCount,
  type TaggedConfessionItem,
} from '@/lib/confessionsIntegrity';

const { height: SCREEN_HEIGHT } = Dimensions.get('window');

// TaggedConfessionItem is now imported from confessionsIntegrity.ts

export default function ConfessionsScreen() {
  const router = useRouter();
  const { openTagged } = useLocalSearchParams<{ openTagged?: string }>();
  const userId = useAuthStore((s) => s.userId);
  const currentUserId = userId || 'demo_user_1';

  // Individual selectors to avoid full re-render on any store change
  const demoConfessions = useConfessionStore((s) => s.confessions);
  const userReactions = useConfessionStore((s) => s.userReactions);
  const secretCrushes = useConfessionStore((s) => s.secretCrushes);
  const chats = useConfessionStore((s) => s.chats);
  const seedConfessions = useConfessionStore((s) => s.seedConfessions);
  const demoToggleReaction = useConfessionStore((s) => s.toggleReaction);
  const demoReportConfession = useConfessionStore((s) => s.reportConfession);
  const addChat = useConfessionStore((s) => s.addChat);
  const revealCrush = useConfessionStore((s) => s.revealCrush);
  const confessionThreads = useConfessionStore((s) => s.confessionThreads);
  const confessionBlockedIds = useConfessionStore((s) => s.blockedIds);
  const reportedConfessionIds = useConfessionStore((s) => s.reportedIds);
  const seenTaggedConfessionIds = useConfessionStore((s) => s.seenTaggedConfessionIds);
  const markTaggedConfessionSeen = useConfessionStore((s) => s.markTaggedConfessionSeen);
  const markAllTaggedConfessionsSeen = useConfessionStore((s) => s.markAllTaggedConfessionsSeen);
  const cleanupExpiredConfessions = useConfessionStore((s) => s.cleanupExpiredConfessions);
  const cleanupExpiredChats = useConfessionStore((s) => s.cleanupExpiredChats);
  const cleanupExpiredSecretCrushes = useConfessionStore((s) => s.cleanupExpiredSecretCrushes);
  const removeConfessionThreads = useConfessionStore((s) => s.removeConfessionThreads);
  const deleteConfession = useConfessionStore((s) => s.deleteConfession);
  const connectToConfession = useConfessionStore((s) => s.connectToConfession);
  const isConfessionConnected = useConfessionStore((s) => s.isConfessionConnected);
  const connectedConfessionIds = useConfessionStore((s) => s.connectedConfessionIds);
  const canPostConfession = useConfessionStore((s) => s.canPostConfession);
  const getConfessionCountToday = useConfessionStore((s) => s.getConfessionCountToday);
  const recordConfessionTimestamp = useConfessionStore((s) => s.recordConfessionTimestamp);
  const blockAuthor = useConfessionStore((s) => s.blockAuthor);

  // Global blocked user IDs (unified via blockStore - includes confession author blocks)
  const globalBlockedIds = useBlockStore((s) => s.blockedUserIds);

  // DM store for conversation metadata
  const conversationMeta = useDemoDmStore((s) => s.meta);

  const { notifyReaction, notifyReply } = useConfessionNotifications();
  const { safeTimeout } = useScreenSafety();
  const [refreshing, setRefreshing] = useState(false);
  const [retryKey, setRetryKey] = useState(0); // For LoadingGuard retry
  const [showToast, setShowToast] = useState(false);
  const [toastMessage, setToastMessage] = useState('Posted anonymously');
  const [toastIcon, setToastIcon] = useState<'checkmark-circle' | 'chatbubbles'>('checkmark-circle');
  const toastOpacity = useRef(new Animated.Value(0)).current;

  // Emoji picker state
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [emojiTargetConfessionId, setEmojiTargetConfessionId] = useState<string | null>(null);

  // Profile preview state (one-time preview for tagged confessions)
  const isPreviewUsed = useConfessPreviewStore((s) => s.isPreviewUsed);
  const [showPreviewConfirm, setShowPreviewConfirm] = useState(false);
  const [previewTarget, setPreviewTarget] = useState<{ confessionId: string; authorId: string } | null>(null);

  // Composer modal state
  const [showComposer, setShowComposer] = useState(false);
  const [composerText, setComposerText] = useState('');
  const [composerAnonymous, setComposerAnonymous] = useState(true);
  const [composerSubmitting, setComposerSubmitting] = useState(false);
  const [showComposerEmoji, setShowComposerEmoji] = useState(false);
  const composerInputRef = useRef<TextInput>(null);
  const insets = useSafeAreaInsets();
  const addConfession = useConfessionStore((s) => s.addConfession);
  const createConfessionMutation = useMutation(api.confessions.createConfession);

  // Tagging (confess-to) state
  const [tagInput, setTagInput] = useState('');
  const [taggedUser, setTaggedUser] = useState<{ id: string; name: string; avatarUrl: string | null; age?: number; disambiguator: string } | null>(null);
  const [showDuplicatePicker, setShowDuplicatePicker] = useState(false);
  const [duplicateCandidates, setDuplicateCandidates] = useState<{ id: string; name: string; avatarUrl: string | null; age?: number; disambiguator: string }[]>([]);

  // Query liked users for tagging candidates
  const convexUserId = asUserId(currentUserId);
  const likedUsersQuery = useQuery(
    api.likes.getLikedUsers,
    !isDemoMode && convexUserId ? { userId: convexUserId } : 'skip'
  );

  // Demo liked users (for demo mode) - IDs must match DEMO_PROFILES for profile lookup
  const demoLikedUsers = useMemo(() => {
    if (!isDemoMode) return [];
    // Use actual DEMO_PROFILES IDs so profile screen can look them up
    return [
      { id: 'demo_profile_2', name: 'Priya', avatarUrl: 'https://i.pravatar.cc/150?img=5', age: 24, disambiguator: 'Loves coffee' },
      { id: 'demo_profile_3', name: 'Rahul', avatarUrl: 'https://i.pravatar.cc/150?img=12', age: 27, disambiguator: 'Tech enthusiast' },
      { id: 'demo_profile_4', name: 'Ananya', avatarUrl: 'https://i.pravatar.cc/150?img=9', age: 25, disambiguator: 'Mumbai' },
      { id: 'demo_profile_5', name: 'Vikram', avatarUrl: 'https://i.pravatar.cc/150?img=11', age: 29, disambiguator: 'Photographer' },
      { id: 'demo_profile_6', name: 'Priya', avatarUrl: 'https://i.pravatar.cc/150?img=16', age: 22, disambiguator: 'Yoga instructor' }, // Duplicate name
    ];
  }, []);

  const likedUsers = useMemo(() => {
    if (isDemoMode) return demoLikedUsers;
    return likedUsersQuery || [];
  }, [isDemoMode, demoLikedUsers, likedUsersQuery]);

  // Tagging suggestions logic
  // Rule: Short names (<=7) require full typing, long names (>7) show suggestions after 3+ chars
  const tagSuggestions = useMemo(() => {
    if (!tagInput || tagInput.length < 3 || taggedUser) return [];

    const inputLower = tagInput.toLowerCase().trim();

    // Filter candidates whose names start with the input
    const matching = likedUsers.filter((u) =>
      u.name.toLowerCase().startsWith(inputLower)
    );

    // Only show suggestions for long names (>7 chars)
    const longNameMatches = matching.filter((u) => u.name.length > 7);

    // Return max 5 suggestions
    return longNameMatches.slice(0, 5);
  }, [tagInput, likedUsers, taggedUser]);

  // Check for exact match (for short names that require full typing)
  const handleTagInputChange = useCallback((text: string) => {
    // If user was previously tagged, log the clear event
    if (taggedUser && text !== taggedUser.name) {
      if (__DEV__) console.log('[CONFESS] confess_tag_cleared_on_edit');
    }
    setTagInput(text);
    setTaggedUser(null); // Clear any selected user when typing

    const inputLower = text.toLowerCase().trim();
    if (!inputLower) return;

    // Find exact matches
    const exactMatches = likedUsers.filter(
      (u) => u.name.toLowerCase() === inputLower
    );

    if (exactMatches.length === 1) {
      // Single exact match - auto-select for short names
      const match = exactMatches[0];
      if (match.name.length <= 7) {
        setTaggedUser(match);
        setTagInput(match.name);
      }
    } else if (exactMatches.length > 1) {
      // Multiple exact matches (duplicates) - show picker
      setDuplicateCandidates(exactMatches);
      setShowDuplicatePicker(true);
    }
  }, [likedUsers]);

  const handleSelectSuggestion = useCallback((user: { id: string; name: string; avatarUrl: string | null; age?: number; disambiguator: string }) => {
    setTaggedUser(user);
    setTagInput(user.name);
  }, []);

  const handleSelectDuplicate = useCallback((user: { id: string; name: string; avatarUrl: string | null; age?: number; disambiguator: string }) => {
    setTaggedUser(user);
    setTagInput(user.name);
    setShowDuplicatePicker(false);
    setDuplicateCandidates([]);
  }, []);

  const handleClearTag = useCallback(() => {
    setTaggedUser(null);
    setTagInput('');
  }, []);

  // Seed demo data on mount
  useEffect(() => {
    seedConfessions();
  }, []);

  // Convex queries (only when not in demo mode)
  const convexConfessions = useQuery(
    api.confessions.listConfessions,
    !isDemoMode ? { sortBy: 'latest' as const } : 'skip'
  );
  const convexTrending = useQuery(
    api.confessions.getTrendingConfessions,
    !isDemoMode ? {} : 'skip'
  );

  // Tagged confessions (confessions where I'm tagged)
  const convexTaggedConfessions = useQuery(
    api.confessions.listTaggedConfessionsForUser,
    !isDemoMode && convexUserId ? { userId: convexUserId } : 'skip'
  );
  const convexTaggedBadgeCount = useQuery(
    api.confessions.getTaggedConfessionBadgeCount,
    !isDemoMode && convexUserId ? { userId: convexUserId } : 'skip'
  );

  // Convex mutations
  const toggleReactionMutation = useMutation(api.confessions.toggleReaction);
  const reportConfessionMutation = useMutation(api.confessions.reportConfession);
  const markTaggedSeenMutation = useMutation(api.confessions.markTaggedConfessionsSeen);

  // ══════════════════════════════════════════════════════════════════════════
  // INTEGRITY MODULE — Single source of truth for confession state
  // ══════════════════════════════════════════════════════════════════════════

  // Build raw tagged confessions for integrity module
  const rawTaggedConfessions = useMemo((): TaggedConfessionItem[] => {
    if (!isDemoMode && convexTaggedConfessions) {
      return convexTaggedConfessions.map((c) => ({
        notificationId: c.notificationId as string,
        confessionId: c.confessionId as string,
        seen: c.seen,
        notificationCreatedAt: c.notificationCreatedAt,
        confessionText: c.confessionText,
        confessionMood: c.confessionMood,
        confessionCreatedAt: c.confessionCreatedAt,
        confessionExpiresAt: c.confessionExpiresAt ?? c.confessionCreatedAt + 24 * 60 * 60 * 1000,
        isExpired: c.isExpired,
        replyCount: c.replyCount,
        reactionCount: c.reactionCount,
      }));
    }
    // Demo mode: use helper with seen tracking
    const seenSet = new Set(seenTaggedConfessionIds);
    return buildDemoTaggedConfessions(demoConfessions, currentUserId, seenSet);
  }, [isDemoMode, convexTaggedConfessions, demoConfessions, currentUserId, seenTaggedConfessionIds]);

  // Process all confession state through the integrity module
  const integrityOutput = useMemo(() => {
    if (!isDemoMode) {
      // Convex mode: minimal processing (backend already filters)
      return {
        activePosts: [] as typeof demoConfessions,
        expiredPostIds: [] as string[],
        activeThreadIds: [] as string[],
        expiredThreadIds: [] as string[],
        activeTaggedConfessions: rawTaggedConfessions.filter((t) => !t.isExpired),
        badgeCount: rawTaggedConfessions.filter((t) => !t.seen && !t.isExpired).length,
        activeSecretCrushes: secretCrushes.filter((sc) => sc.toUserId === currentUserId && !sc.isRevealed && Date.now() <= sc.expiresAt),
        expiredSecretCrushIds: secretCrushes.filter((sc) => Date.now() > sc.expiresAt).map((sc) => sc.id),
        activeChats: chats.filter((c) => Date.now() <= c.expiresAt),
        expiredChatIds: chats.filter((c) => Date.now() > c.expiresAt).map((c) => c.id),
      };
    }
    // Demo mode: full integrity processing
    return processConfessionsIntegrity({
      confessions: demoConfessions,
      taggedConfessions: rawTaggedConfessions,
      confessionThreads,
      conversationMeta,
      blockedUserIds: globalBlockedIds,
      confessionBlockedIds,
      reportedConfessionIds,
      secretCrushes,
      confessionChats: chats,
      seenConfessionIds: new Set(seenTaggedConfessionIds),
      currentUserId,
    });
  }, [
    isDemoMode,
    demoConfessions,
    rawTaggedConfessions,
    confessionThreads,
    conversationMeta,
    globalBlockedIds,
    confessionBlockedIds,
    reportedConfessionIds,
    secretCrushes,
    chats,
    seenTaggedConfessionIds,
    currentUserId,
  ]);

  // Cleanup expired items on mount/refresh (guarded to prevent loops)
  const cleanupDoneRef = useRef(false);
  useEffect(() => {
    if (cleanupDoneRef.current) return;
    if (!isDemoMode) return; // Only cleanup in demo mode

    const { expiredPostIds, expiredThreadIds, expiredChatIds, expiredSecretCrushIds } = integrityOutput;

    if (expiredPostIds.length > 0) {
      cleanupExpiredConfessions(expiredPostIds);
    }
    if (expiredThreadIds.length > 0) {
      removeConfessionThreads(expiredThreadIds);
    }
    if (expiredChatIds.length > 0) {
      cleanupExpiredChats(expiredChatIds);
    }
    if (expiredSecretCrushIds.length > 0) {
      cleanupExpiredSecretCrushes(expiredSecretCrushIds);
    }

    if (expiredPostIds.length > 0 || expiredThreadIds.length > 0 || expiredChatIds.length > 0 || expiredSecretCrushIds.length > 0) {
      cleanupDoneRef.current = true;
    }
  }, [isDemoMode, integrityOutput, cleanupExpiredConfessions, removeConfessionThreads, cleanupExpiredChats, cleanupExpiredSecretCrushes]);

  // Use Convex data when available, demo data from integrity module as fallback
  const confessions = useMemo(() => {
    if (!isDemoMode && convexConfessions) {
      let items = convexConfessions.map((c: any) => ({
        id: c._id,
        userId: c.userId,
        text: c.text,
        isAnonymous: c.isAnonymous,
        mood: c.mood,
        authorName: c.authorName,
        authorPhotoUrl: c.authorPhotoUrl,
        topEmojis: c.topEmojis || [],
        replyPreviews: c.replyPreviews || [],
        replyCount: c.replyCount,
        reactionCount: c.reactionCount,
        createdAt: c.createdAt,
        visibility: c.visibility,
        revealPolicy: 'never' as const,
        targetUserId: c.taggedUserId,
      }));
      // Filter blocked users (unified via blockStore)
      if (globalBlockedIds.length > 0) {
        items = items.filter((c) => !globalBlockedIds.includes(c.userId));
      }
      return items;
    }
    // Demo mode: use integrity output (already filtered and sorted)
    // Also filter blocked users via blockStore
    let posts = integrityOutput.activePosts;
    if (globalBlockedIds.length > 0) {
      posts = posts.filter((c) => !globalBlockedIds.includes(c.userId));
    }
    return posts;
  }, [isDemoMode, convexConfessions, globalBlockedIds, integrityOutput.activePosts]);

  // Trending confessions
  const trendingConfessions = useMemo(() => {
    if (!isDemoMode && convexTrending) {
      return convexTrending.map((c: any) => ({
        id: c._id,
        userId: c.userId,
        text: c.text,
        isAnonymous: c.isAnonymous,
        mood: c.mood,
        authorName: c.authorName as string | undefined,
        replyCount: c.replyCount,
        reactionCount: c.reactionCount,
        createdAt: c.createdAt,
        trendingScore: c.trendingScore,
      }));
    }
    // Demo mode — compute trending from active posts only
    const now = Date.now();
    const cutoff = now - 48 * 60 * 60 * 1000;
    const recent = integrityOutput.activePosts.filter((c) => c.createdAt > cutoff);
    const scored = recent.map((c) => {
      const hoursSince = (now - c.createdAt) / (1000 * 60 * 60);
      const score = (c.reactionCount * 3 + c.replyCount * 4) / (hoursSince + 2);
      return { ...c, trendingScore: score };
    });
    scored.sort((a, b) => (b.trendingScore || 0) - (a.trendingScore || 0));
    return scored.slice(0, 1);
  }, [isDemoMode, convexTrending, integrityOutput.activePosts]);

  // Secret crushes from integrity output
  const myCrushes = integrityOutput.activeSecretCrushes;

  // Tagged confessions and badge from integrity output
  const [showTaggedSection, setShowTaggedSection] = useState(false);
  const taggedConfessions = integrityOutput.activeTaggedConfessions;

  // Badge count: from integrity module (single source of truth)
  const taggedBadgeCount = useMemo(() => {
    if (!isDemoMode && convexTaggedBadgeCount !== undefined) {
      return convexTaggedBadgeCount;
    }
    // Demo mode: use integrity output badge count
    return integrityOutput.badgeCount;
  }, [isDemoMode, convexTaggedBadgeCount, integrityOutput.badgeCount]);

  const handleOpenTaggedSection = useCallback(() => {
    setShowTaggedSection(true);
    // Mark all as seen
    if (!isDemoMode && convexUserId) {
      markTaggedSeenMutation({ userId: convexUserId }).catch(() => {});
    } else if (isDemoMode) {
      // Demo mode: mark all tagged confessions as seen via store action
      const unseenIds = taggedConfessions.filter((t) => !t.seen).map((t) => t.confessionId);
      if (unseenIds.length > 0) {
        markAllTaggedConfessionsSeen(unseenIds);
      }
    }
  }, [isDemoMode, convexUserId, markTaggedSeenMutation, taggedConfessions, markAllTaggedConfessionsSeen]);

  const handleCloseTaggedSection = useCallback(() => {
    setShowTaggedSection(false);
  }, []);

  // Auto-open Tagged modal if query param is set (from QA checklist)
  useEffect(() => {
    if (openTagged === 'true' && taggedConfessions.length > 0) {
      handleOpenTaggedSection();
    }
  }, [openTagged, taggedConfessions.length, handleOpenTaggedSection]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    safeTimeout(() => setRefreshing(false), 800);
  }, [safeTimeout]);

  const handleOpenEmojiPicker = useCallback((confessionId: string) => {
    setEmojiTargetConfessionId(confessionId);
    setShowEmojiPicker(true);
  }, []);

  // Show toast with custom message
  const showToastMessage = useCallback((message: string, icon: 'checkmark-circle' | 'chatbubbles' = 'checkmark-circle') => {
    setToastMessage(message);
    setToastIcon(icon);
    setShowToast(true);
    Animated.sequence([
      Animated.timing(toastOpacity, { toValue: 1, duration: 200, useNativeDriver: true }),
      Animated.delay(2000),
      Animated.timing(toastOpacity, { toValue: 0, duration: 200, useNativeDriver: true }),
    ]).start(() => setShowToast(false));
  }, [toastOpacity]);

  // BUGFIX #24: Track pending reactions to prevent double toast on rapid taps
  const pendingReactionsRef = useRef<Set<string>>(new Set());

  const toggleReaction = useCallback(
    (confessionId: string, emoji: string) => {
      // BUGFIX #24: Debounce - skip if already processing this confession
      const reactionKey = `${confessionId}:${emoji}`;
      if (pendingReactionsRef.current.has(reactionKey)) return;
      pendingReactionsRef.current.add(reactionKey);

      // Clear pending after animation completes
      setTimeout(() => pendingReactionsRef.current.delete(reactionKey), 500);

      if (isDemoMode) {
        const result = demoToggleReaction(confessionId, emoji, currentUserId);
        if (result?.chatUnlocked) {
          showToastMessage('Chat unlocked! Check Messages', 'chatbubbles');
          logDebugEvent('CHAT_UNLOCKED', 'Tagged user liked confession → chat unlocked');
        }
        // BUGFIX #24: Only notify in demo mode (no duplicate with Convex)
        notifyReaction(confessionId);
        return;
      }
      const convexUserId = asUserId(currentUserId);
      // BUGFIX #24: Don't call demoToggleReaction in Convex mode - causes duplicate state updates
      if (!convexUserId) return; // no valid user id — skip mutation
      toggleReactionMutation({
        confessionId: confessionId as any,
        userId: convexUserId,
        type: emoji,
      }).then((result) => {
        if (result?.chatUnlocked) {
          showToastMessage('Chat unlocked! Check Messages', 'chatbubbles');
        }
        // BUGFIX #24: Notify only on successful Convex mutation, not before
        notifyReaction(confessionId);
      }).catch((err) => {
        console.error('[Confessions] toggleReaction failed:', err);
      });
      // BUGFIX #24: Removed duplicate notifyReaction call here
    },
    [demoToggleReaction, notifyReaction, toggleReactionMutation, currentUserId, showToastMessage]
  );

  const handleEmojiSelected = useCallback(
    (emojiObj: any) => {
      if (!emojiTargetConfessionId) return;
      toggleReaction(emojiTargetConfessionId, emojiObj.emoji);
    },
    [emojiTargetConfessionId, toggleReaction]
  );

  const handleOpenCompose = useCallback(() => {
    setComposerText('');
    setComposerAnonymous(true);
    setTagInput('');
    setTaggedUser(null);
    setShowDuplicatePicker(false);
    setDuplicateCandidates([]);
    setShowComposer(true);
    // Focus input after modal opens
    setTimeout(() => composerInputRef.current?.focus(), 100);
  }, []);

  const handleCloseComposer = useCallback(() => {
    Keyboard.dismiss();
    setShowComposer(false);
  }, []);

  const canSubmitComposer = composerText.trim().length >= 10 && !composerSubmitting;

  const handleSubmitComposer = useCallback(() => {
    if (!canSubmitComposer) return;
    const trimmed = composerText.trim();

    // Rate limit check
    if (!canPostConfession()) {
      if (__DEV__) console.log('[CONFESS] confess_rate_limit_hit');
      Alert.alert(
        'Limit Reached',
        "You've reached today's confession limit. Try again later."
      );
      return;
    }

    // Tag accuracy lock: if mention text exists but no valid selection, block
    if (tagInput.trim() && !taggedUser) {
      if (__DEV__) console.log('[CONFESS] confess_tag_blocked_submit');
      Alert.alert(
        'Select a Person',
        'Please select a person from the suggestions to tag them, or clear the tag field.'
      );
      return;
    }

    // Validation
    const phonePattern = /\b\d{10,}\b|\b\d{3}[-.\s]?\d{3}[-.\s]?\d{4}\b/;
    const emailPattern = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/;
    if (phonePattern.test(trimmed) || emailPattern.test(trimmed)) {
      Alert.alert('Safety Warning', "Don't include phone numbers or personal details.");
      return;
    }
    if (!isContentClean(trimmed)) {
      Alert.alert('Content Warning', 'Your confession contains inappropriate content. Please revise it.');
      return;
    }

    setComposerSubmitting(true);

    const confessionId = `conf_new_${Date.now()}`;
    addConfession({
      id: confessionId,
      userId: currentUserId,
      text: trimmed,
      isAnonymous: composerAnonymous,
      mood: 'emotional' as const,
      topEmojis: [],
      replyPreviews: [],
      visibility: 'global' as const,
      replyCount: 0,
      reactionCount: 0,
      createdAt: Date.now(),
      revealPolicy: 'never',
      targetUserId: taggedUser?.id,
      targetUserName: taggedUser?.name,
    });

    // Sync to backend
    if (!isDemoMode) {
      createConfessionMutation({
        userId: currentUserId as any,
        text: trimmed,
        isAnonymous: composerAnonymous,
        mood: 'emotional' as any,
        visibility: 'global' as any,
        taggedUserId: taggedUser?.id as any,
      }).catch((error: any) => {
        Alert.alert('Error', error.message || 'Failed to post confession');
      });
    }

    // Record timestamp for rate limiting
    recordConfessionTimestamp();

    // Haptic feedback for successful post
    triggerSuccessHaptic();

    setComposerSubmitting(false);
    setShowComposer(false);
    setComposerText('');
    setTagInput('');
    setTaggedUser(null);
  }, [canSubmitComposer, composerText, composerAnonymous, currentUserId, addConfession, createConfessionMutation, taggedUser, canPostConfession, tagInput, recordConfessionTimestamp]);

  const handleComposerEmojiSelected = useCallback((emojiObj: any) => {
    setComposerText((prev) => prev + emojiObj.emoji);
  }, []);

  const handleOpenMyConfessions = useCallback(() => {
    router.push('/(main)/my-confessions' as any);
  }, [router]);

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
        router.push(`/(main)/confession-chat?chatId=${existing.id}` as any);
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
      router.push(`/(main)/confession-chat?chatId=${newChat.id}` as any);
      notifyReply(confessionId);
    },
    [chats, currentUserId, addChat, notifyReply, router]
  );

  // Handle Report/Block menu for a confession
  const handleReportBlock = useCallback(
    (confessionId: string, authorId: string) => {
      const options = Platform.OS === 'ios'
        ? ['Cancel', 'Report Confession', 'Block User']
        : undefined;

      if (Platform.OS === 'ios') {
        ActionSheetIOS.showActionSheetWithOptions(
          {
            options: options!,
            cancelButtonIndex: 0,
            destructiveButtonIndex: 2,
            title: 'Actions',
          },
          (buttonIndex) => {
            if (buttonIndex === 1) {
              // Report
              demoReportConfession(confessionId);
              if (__DEV__) console.log('[CONFESS] confess_reported:', confessionId);
              if (!isDemoMode) {
                const convexUserId = asUserId(currentUserId);
                if (convexUserId) {
                  reportConfessionMutation({
                    confessionId: confessionId as any,
                    reporterId: convexUserId,
                  }).catch(() => {});
                }
              }
              triggerWarningHaptic();
              showToastMessage('Reported', 'checkmark-circle');
            } else if (buttonIndex === 2) {
              // Block
              blockAuthor(authorId);
              triggerWarningHaptic();
              showToastMessage('User blocked', 'checkmark-circle');
            }
          }
        );
      } else {
        // Android: use Alert with buttons
        Alert.alert(
          'Actions',
          'What would you like to do?',
          [
            { text: 'Cancel', style: 'cancel' },
            {
              text: 'Report Confession',
              onPress: () => {
                demoReportConfession(confessionId);
                if (__DEV__) console.log('[CONFESS] confess_reported:', confessionId);
                if (!isDemoMode) {
                  const convexUserId = asUserId(currentUserId);
                  if (convexUserId) {
                    reportConfessionMutation({
                      confessionId: confessionId as any,
                      reporterId: convexUserId,
                    }).catch(() => {});
                  }
                }
                triggerWarningHaptic();
                showToastMessage('Reported', 'checkmark-circle');
              },
            },
            {
              text: 'Block User',
              style: 'destructive',
              onPress: () => {
                blockAuthor(authorId);
                triggerWarningHaptic();
                showToastMessage('User blocked', 'checkmark-circle');
              },
            },
          ]
        );
      }
    },
    [demoReportConfession, reportConfessionMutation, currentUserId, showToastMessage, blockAuthor]
  );

  const handleReport = useCallback(
    (confessionId: string) => {
      // Legacy handler - now just logs and reports
      demoReportConfession(confessionId);
      if (__DEV__) console.log('[CONFESS] confess_reported:', confessionId);
      if (!isDemoMode) {
        const convexUserId = asUserId(currentUserId);
        if (!convexUserId) return;
        reportConfessionMutation({
          confessionId: confessionId as any,
          reporterId: convexUserId,
        }).catch(() => {});
      }
      // Show confirmation toast
      showToastMessage('Reported', 'checkmark-circle');
    },
    [demoReportConfession, reportConfessionMutation, currentUserId, showToastMessage]
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

  // Profile preview handlers (one-time preview for tagged confession receivers)
  const handleViewProfileRequest = useCallback(
    (confessionId: string, authorId: string) => {
      // Check if already used
      if (isPreviewUsed(confessionId, currentUserId)) {
        Alert.alert('Already Viewed', 'You have already used your one-time profile preview for this confession.');
        return;
      }
      // Show confirmation modal
      setPreviewTarget({ confessionId, authorId });
      setShowPreviewConfirm(true);
    },
    [isPreviewUsed, currentUserId]
  );

  const handleConfirmPreview = useCallback(() => {
    if (!previewTarget) return;
    // Close modal first
    setShowPreviewConfirm(false);
    const { confessionId, authorId } = previewTarget;
    setPreviewTarget(null);
    // Navigate to profile in read-only mode
    // Pass confessionId and receiverId so the profile screen can mark preview as used on mount
    router.push({
      pathname: '/(main)/profile/[id]',
      params: {
        id: authorId,
        mode: 'confess_preview',
        confessionId,
        receiverId: currentUserId,
      },
    } as any);
    // NOTE: markPreviewUsed is called in the profile screen on successful mount, not here
  }, [previewTarget, currentUserId, router]);

  const handleCancelPreview = useCallback(() => {
    setShowPreviewConfirm(false);
    setPreviewTarget(null);
  }, []);

  // Handle tapping @tag to open profile preview (read-only)
  const handleTagPress = useCallback(
    (targetUserId: string) => {
      router.push({
        pathname: '/(main)/profile/[id]',
        params: { id: targetUserId, mode: 'confess_preview' },
      } as any);
    },
    [router]
  );

  // Handle Connect button (tagged user only)
  const handleConnect = useCallback(
    (confessionId: string, authorName?: string) => {
      const displayName = authorName || 'this person';
      const dialogMessage = `Connect with ${displayName} and start chatting in Messages?`;

      if (Platform.OS === 'ios') {
        ActionSheetIOS.showActionSheetWithOptions(
          {
            options: ['Cancel', 'Connect'],
            cancelButtonIndex: 0,
            title: 'Connect?',
            message: dialogMessage,
          },
          (buttonIndex) => {
            if (buttonIndex === 1) {
              const success = connectToConfession(confessionId, currentUserId);
              if (success) {
                if (__DEV__) console.log('[CONFESS] confess_connect_confirmed');
                triggerSuccessHaptic();
                showToastMessage('Connected! Check Messages', 'chatbubbles');
              }
            }
          }
        );
      } else {
        Alert.alert(
          'Connect?',
          dialogMessage,
          [
            { text: 'Cancel', style: 'cancel' },
            {
              text: 'Connect',
              onPress: () => {
                const success = connectToConfession(confessionId, currentUserId);
                if (success) {
                  if (__DEV__) console.log('[CONFESS] confess_connect_confirmed');
                  triggerSuccessHaptic();
                  showToastMessage('Connected! Check Messages', 'chatbubbles');
                }
              },
            },
          ]
        );
      }
    },
    [connectToConfession, currentUserId, showToastMessage]
  );

  // Long-press delete handler (author only)
  const handleLongPressConfession = useCallback(
    (confessionId: string, authorId: string) => {
      // Only allow delete for the author
      if (authorId !== currentUserId) {
        // Non-author: show info toast
        showToastMessage('You can only delete your own confession', 'checkmark-circle');
        return;
      }

      // Author: show delete confirmation
      if (Platform.OS === 'ios') {
        ActionSheetIOS.showActionSheetWithOptions(
          {
            options: ['Cancel', 'Delete Confession'],
            destructiveButtonIndex: 1,
            cancelButtonIndex: 0,
            title: 'Delete this confession?',
            message: 'This action cannot be undone.',
          },
          (buttonIndex) => {
            if (buttonIndex === 1) {
              deleteConfession(confessionId);
              triggerWarningHaptic();
              showToastMessage('Confession deleted', 'checkmark-circle');
            }
          }
        );
      } else {
        // Android: use Alert
        Alert.alert(
          'Delete Confession',
          'This action cannot be undone.',
          [
            { text: 'Cancel', style: 'cancel' },
            {
              text: 'Delete',
              style: 'destructive',
              onPress: () => {
                deleteConfession(confessionId);
                triggerWarningHaptic();
                showToastMessage('Confession deleted', 'checkmark-circle');
              },
            },
          ]
        );
      }
    },
    [currentUserId, deleteConfession, showToastMessage]
  );

  const isLoading = !isDemoMode && convexConfessions === undefined && demoConfessions.length === 0;

  // BUGFIX #20: Trending hero card with null/empty guards
  const trendingHero = trendingConfessions.length > 0 && trendingConfessions[0]?.text
    ? trendingConfessions[0]
    : null;

  const renderListHeader = useCallback(() => (
    <View>
      {/* Tagged for you section */}
      {taggedConfessions.length > 0 && (
        <TouchableOpacity
          style={styles.taggedForYouRow}
          onPress={handleOpenTaggedSection}
          activeOpacity={0.7}
        >
          <View style={styles.taggedForYouLeft}>
            <Ionicons name="heart" size={18} color={COLORS.primary} />
            <Text style={styles.taggedForYouText}>Tagged for you</Text>
            {taggedBadgeCount > 0 && (
              <View style={styles.taggedBadge}>
                <Text style={styles.taggedBadgeText}>{taggedBadgeCount}</Text>
              </View>
            )}
          </View>
          <Ionicons name="chevron-forward" size={18} color={COLORS.textMuted} />
        </TouchableOpacity>
      )}

      {/* Secret Crushes */}
      {myCrushes.length > 0 && (
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
      )}

      {/* Trending Section */}
      {trendingConfessions.length > 0 && (
        <View style={styles.trendingSection}>
          <View style={styles.trendingSectionHeader}>
            <Ionicons name="flame" size={16} color="#FF6B00" />
            <Text style={styles.trendingSectionTitle}>Trending</Text>
          </View>

          {/* Hero card (first trending) */}
          {trendingHero && (
            <TouchableOpacity
              style={styles.trendingHeroCard}
              onPress={() => handleOpenThread(trendingHero.id)}
              activeOpacity={0.85}
            >
              <Text style={styles.trendingHeroText} numberOfLines={3}>
                {trendingHero.text}
                {(trendingHero as any).targetUserId && (trendingHero as any).targetUserName && (
                  <>
                    {' '}
                    <Text
                      style={styles.trendingHeroTagLink}
                      onPress={(e) => {
                        e.stopPropagation?.();
                        handleTagPress((trendingHero as any).targetUserId);
                      }}
                    >
                      @{(trendingHero as any).targetUserName}
                    </Text>
                  </>
                )}
              </Text>
              <View style={styles.trendingHeroMeta}>
                <View style={styles.trendingHeroStat}>
                  <Ionicons name="chatbubble-outline" size={12} color={COLORS.white} />
                  <Text style={styles.trendingHeroStatText}>{trendingHero.replyCount}</Text>
                </View>
                <View style={styles.trendingHeroStat}>
                  <Ionicons name="heart-outline" size={12} color={COLORS.white} />
                  <Text style={styles.trendingHeroStatText}>{trendingHero.reactionCount}</Text>
                </View>
              </View>
            </TouchableOpacity>
          )}

        </View>
      )}
    </View>
  ), [myCrushes, trendingConfessions, trendingHero, handleRevealCrush, revealCrush, handleOpenThread, taggedConfessions, taggedBadgeCount, handleOpenTaggedSection]);

  return (
    <LoadingGuard
      isLoading={isLoading}
      onRetry={() => setRetryKey((k) => k + 1)}
      title="Finding confessions…"
      subtitle="This is taking longer than expected. Check your connection and try again."
    >
      <SafeAreaView style={styles.container} edges={['top']}>
        {/* Compact header */}
        <View style={styles.header}>
          <Ionicons name="megaphone" size={16} color={COLORS.primary} />
          <Text style={styles.headerTitle}>Confess</Text>
          <View style={{ flex: 1 }} />
          <TouchableOpacity
            onPress={handleOpenMyConfessions}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            style={styles.headerButton}
          >
            <Ionicons name="document-text-outline" size={18} color={COLORS.text} />
          </TouchableOpacity>
        </View>

        {/* Top hint */}
        <Text style={styles.topHint}>Anonymous by default • Be respectful</Text>

        {/* Feed */}
        <FlatList
        data={confessions}
        keyExtractor={(item) => item.id}
        ListHeaderComponent={renderListHeader}
        renderItem={({ item }) => {
          const isTaggedForMe = (item as any).targetUserId === currentUserId;
          const hasTag = item.targetUserId && (item as any).targetUserName;
          const authorDisplayName = item.isAnonymous ? 'Anonymous' : ((item as any).authorName || 'Someone');
          return (
            <ConfessionCard
              id={item.id}
              text={item.text}
              isAnonymous={item.isAnonymous}
              mood={item.mood}
              topEmojis={item.topEmojis || []}
              userEmoji={userReactions[item.id] && isProbablyEmoji(userReactions[item.id]!) ? userReactions[item.id]! : null}
              replyPreviews={item.replyPreviews || []}
              replyCount={item.replyCount}
              reactionCount={item.reactionCount}
              authorName={(item as any).authorName}
              createdAt={item.createdAt}
              isTaggedForMe={isTaggedForMe}
              previewUsed={isTaggedForMe ? isPreviewUsed(item.id, currentUserId) : undefined}
              isConnected={isConfessionConnected(item.id)}
              taggedUserId={item.targetUserId}
              taggedUserName={(item as any).targetUserName}
              authorId={item.userId}
              viewerId={currentUserId}
              onPress={() => handleOpenThread(item.id)}
              onReact={() => handleOpenEmojiPicker(item.id)}
              onToggleEmoji={(emoji) => toggleReaction(item.id, emoji)}
              onReplyAnonymously={() => handleReplyAnonymously(item.id, item.userId)}
              onReport={() => handleReportBlock(item.id, item.userId)}
              onViewProfile={isTaggedForMe ? () => handleViewProfileRequest(item.id, item.userId) : undefined}
              onLongPress={() => handleLongPressConfession(item.id, item.userId)}
              onTagPress={hasTag ? () => handleTagPress(item.targetUserId!) : undefined}
              onConnect={isTaggedForMe ? () => handleConnect(item.id, authorDisplayName) : undefined}
            />
          );
        }}
        contentContainerStyle={styles.listContent}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.primary} />
        }
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={
          isLoading ? (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="large" color={COLORS.primary} />
              <Text style={styles.loadingText}>Finding confessions...</Text>
            </View>
          ) : (
            <View style={styles.emptyContainer}>
              <Text style={styles.emptyEmoji}>💬</Text>
              <Text style={styles.emptyTitle}>No confessions yet</Text>
              <Text style={styles.emptySubtitle}>Be the first to share something — it's anonymous by default.</Text>
              <TouchableOpacity style={styles.emptyButton} onPress={handleOpenCompose}>
                <Text style={styles.emptyButtonText}>Post a Confession</Text>
              </TouchableOpacity>
            </View>
          )
        }
      />

      {/* Success Toast */}
      {showToast && (
        <Animated.View style={[styles.toast, { opacity: toastOpacity }]}>
          <Ionicons
            name={toastIcon}
            size={18}
            color={toastIcon === 'chatbubbles' ? COLORS.primary : '#34C759'}
          />
          <Text style={styles.toastText}>{toastMessage}</Text>
        </Animated.View>
      )}

      {/* FAB */}
      <TouchableOpacity
        style={styles.fab}
        onPress={handleOpenCompose}
        activeOpacity={0.85}
      >
        <Ionicons name="add" size={24} color={COLORS.white} />
      </TouchableOpacity>

      {/* Emoji Picker for reactions */}
      <EmojiPicker
        onEmojiSelected={handleEmojiSelected}
        open={showEmojiPicker}
        onClose={() => {
          setShowEmojiPicker(false);
          setEmojiTargetConfessionId(null);
        }}
      />

      {/* Composer Bottom Sheet Modal */}
      <Modal
        visible={showComposer}
        animationType="slide"
        transparent
        onRequestClose={handleCloseComposer}
      >
        <TouchableWithoutFeedback onPress={handleCloseComposer}>
          <View style={styles.composerOverlay}>
            <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
              <KeyboardAvoidingView
                behavior={Platform.OS === 'ios' ? 'padding' : undefined}
                style={styles.composerSheet}
              >
                {/* Drag handle */}
                <View style={styles.composerHandle} />

                {/* Header */}
                <View style={styles.composerHeader}>
                  <TouchableOpacity onPress={handleCloseComposer} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
                    <Ionicons name="close" size={24} color={COLORS.text} />
                  </TouchableOpacity>
                  <Text style={styles.composerTitle}>New Confession</Text>
                  <TouchableOpacity
                    onPress={handleSubmitComposer}
                    disabled={!canSubmitComposer}
                    style={[styles.composerSubmitBtn, !canSubmitComposer && styles.composerSubmitBtnDisabled]}
                  >
                    <Text style={[styles.composerSubmitText, !canSubmitComposer && styles.composerSubmitTextDisabled]}>
                      {composerSubmitting ? 'Posting...' : 'Post'}
                    </Text>
                  </TouchableOpacity>
                </View>

                {/* Safety banner */}
                <View style={styles.composerSafetyBanner}>
                  <Ionicons name="shield-checkmark" size={14} color={COLORS.primary} />
                  <Text style={styles.composerSafetyText}>Don't include phone numbers or personal details.</Text>
                </View>

                {/* Text input */}
                <TextInput
                  ref={composerInputRef}
                  style={styles.composerInput}
                  placeholder="What's on your mind? Share your confession..."
                  placeholderTextColor={COLORS.textMuted}
                  multiline
                  maxLength={500}
                  value={composerText}
                  onChangeText={setComposerText}
                  textAlignVertical="top"
                />

                {/* Toolbar */}
                <View style={styles.composerToolbar}>
                  <TouchableOpacity onPress={() => setShowComposerEmoji(true)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                    <Text style={{ fontSize: 20 }}>🙂</Text>
                  </TouchableOpacity>
                  <View style={{ flex: 1 }} />
                  <Text style={styles.composerCharCount}>{composerText.length}/500</Text>
                </View>

                {/* Confess-to tagging */}
                <View style={styles.tagSection}>
                  <View style={styles.tagHeader}>
                    <Ionicons name="heart-outline" size={18} color={COLORS.primary} />
                    <Text style={styles.tagLabel}>Mention username (optional)</Text>
                  </View>

                  {taggedUser ? (
                    <View style={styles.taggedUserRow}>
                      <Text style={styles.taggedLabel}>Tagged:</Text>
                      {taggedUser.avatarUrl ? (
                        <Image
                          source={{ uri: taggedUser.avatarUrl }}
                          style={styles.taggedUserAvatarImg}
                          contentFit="cover"
                        />
                      ) : (
                        <View style={styles.taggedUserAvatar}>
                          <Ionicons name="person" size={16} color={COLORS.white} />
                        </View>
                      )}
                      <View style={{ flex: 1 }}>
                        <Text style={styles.taggedUserName}>
                          {taggedUser.name}{taggedUser.age ? `, ${taggedUser.age}` : ''}
                        </Text>
                        <Text style={styles.taggedUserDisambiguator}>{taggedUser.disambiguator}</Text>
                      </View>
                      <TouchableOpacity onPress={handleClearTag} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                        <Ionicons name="close-circle" size={20} color={COLORS.textMuted} />
                      </TouchableOpacity>
                    </View>
                  ) : (
                    <View>
                      <TextInput
                        style={styles.tagInput}
                        placeholder="Type a name from people you've liked..."
                        placeholderTextColor={COLORS.textMuted}
                        value={tagInput}
                        onChangeText={handleTagInputChange}
                        editable={!taggedUser}
                      />
                      {likedUsers.length === 0 ? (
                        <Text style={styles.tagHint}>Like someone first to confess to them</Text>
                      ) : (
                        <Text style={styles.tagHintSubtle}>You can only tag people you liked</Text>
                      )}
                    </View>
                  )}

                  {/* Long name suggestions (>7 chars) */}
                  {tagSuggestions.length > 0 && !taggedUser && (
                    <View style={styles.suggestionsList}>
                      {tagSuggestions.map((user) => (
                        <TouchableOpacity
                          key={user.id}
                          style={styles.suggestionRow}
                          onPress={() => handleSelectSuggestion(user)}
                        >
                          <View style={styles.suggestionAvatar}>
                            <Ionicons name="person" size={14} color={COLORS.white} />
                          </View>
                          <View style={{ flex: 1 }}>
                            <Text style={styles.suggestionName}>{user.name}</Text>
                            <Text style={styles.suggestionDisambiguator}>{user.disambiguator}</Text>
                          </View>
                        </TouchableOpacity>
                      ))}
                    </View>
                  )}
                </View>

                {/* Anonymous / Open toggle */}
                <View style={styles.composerToggleRow}>
                  <View style={styles.composerToggleInfo}>
                    <Ionicons
                      name={composerAnonymous ? 'eye-off' : 'person'}
                      size={20}
                      color={composerAnonymous ? COLORS.textMuted : COLORS.primary}
                    />
                    <View>
                      <Text style={styles.composerToggleLabel}>{composerAnonymous ? 'Anonymous' : 'Open to all'}</Text>
                      <Text style={styles.composerToggleDesc}>
                        {composerAnonymous ? 'Your identity is hidden' : 'Your profile will be visible'}
                      </Text>
                    </View>
                  </View>
                  <Switch
                    value={!composerAnonymous}
                    onValueChange={(val) => setComposerAnonymous(!val)}
                    trackColor={{ false: COLORS.border, true: COLORS.primaryLight }}
                    thumbColor={!composerAnonymous ? COLORS.primary : '#f4f3f4'}
                  />
                </View>

                {/* Bottom padding for safe area */}
                <View style={{ height: insets.bottom + 10 }} />
              </KeyboardAvoidingView>
            </TouchableWithoutFeedback>
          </View>
        </TouchableWithoutFeedback>

        {/* Emoji picker for composer */}
        <EmojiPicker
          onEmojiSelected={handleComposerEmojiSelected}
          open={showComposerEmoji}
          onClose={() => setShowComposerEmoji(false)}
        />

        {/* Duplicate name picker modal */}
        <Modal
          visible={showDuplicatePicker}
          animationType="fade"
          transparent
          onRequestClose={() => setShowDuplicatePicker(false)}
        >
          <TouchableWithoutFeedback onPress={() => setShowDuplicatePicker(false)}>
            <View style={styles.duplicateOverlay}>
              <TouchableWithoutFeedback>
                <View style={styles.duplicateSheet}>
                  <Text style={styles.duplicateTitle}>Multiple people named "{tagInput}"</Text>
                  <Text style={styles.duplicateSubtitle}>Select who you want to confess to:</Text>
                  {duplicateCandidates.map((user) => (
                    <TouchableOpacity
                      key={user.id}
                      style={styles.duplicateRow}
                      onPress={() => handleSelectDuplicate(user)}
                    >
                      {user.avatarUrl ? (
                        <Image
                          source={{ uri: user.avatarUrl }}
                          style={styles.duplicateAvatarImage}
                          contentFit="cover"
                        />
                      ) : (
                        <View style={styles.duplicateAvatar}>
                          <Ionicons name="person" size={18} color={COLORS.white} />
                        </View>
                      )}
                      <View style={{ flex: 1 }}>
                        <Text style={styles.duplicateName} numberOfLines={1}>
                          {user.name}{user.age ? `, ${user.age}` : ''}
                        </Text>
                        <Text style={styles.duplicateDisambiguator} numberOfLines={1}>
                          {user.disambiguator}
                        </Text>
                      </View>
                      <Ionicons name="chevron-forward" size={18} color={COLORS.textMuted} />
                    </TouchableOpacity>
                  ))}
                </View>
              </TouchableWithoutFeedback>
            </View>
          </TouchableWithoutFeedback>
        </Modal>
      </Modal>

      {/* Profile Preview Confirmation Modal */}
      <Modal
        visible={showPreviewConfirm}
        animationType="fade"
        transparent
        onRequestClose={handleCancelPreview}
      >
        <TouchableWithoutFeedback onPress={handleCancelPreview}>
          <View style={styles.previewConfirmOverlay}>
            <TouchableWithoutFeedback>
              <View style={styles.previewConfirmSheet}>
                <View style={styles.previewConfirmIcon}>
                  <Ionicons name="eye-outline" size={32} color={COLORS.primary} />
                </View>
                <Text style={styles.previewConfirmTitle}>View Profile?</Text>
                <Text style={styles.previewConfirmDesc}>
                  You can view this person's profile once. This is your only chance to see who confessed to you.
                </Text>
                <View style={styles.previewConfirmActions}>
                  <TouchableOpacity
                    style={styles.previewConfirmCancelBtn}
                    onPress={handleCancelPreview}
                  >
                    <Text style={styles.previewConfirmCancelText}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.previewConfirmViewBtn}
                    onPress={handleConfirmPreview}
                  >
                    <Ionicons name="eye" size={18} color={COLORS.white} />
                    <Text style={styles.previewConfirmViewText}>View Profile</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </TouchableWithoutFeedback>
          </View>
        </TouchableWithoutFeedback>
      </Modal>

      {/* Tagged for you modal */}
      <Modal
        visible={showTaggedSection}
        animationType="slide"
        transparent
        onRequestClose={handleCloseTaggedSection}
      >
        <View style={styles.taggedModalOverlay}>
          <View style={styles.taggedModalSheet}>
            {/* Header */}
            <View style={styles.taggedModalHeader}>
              <TouchableOpacity onPress={handleCloseTaggedSection} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
                <Ionicons name="chevron-back" size={24} color={COLORS.text} />
              </TouchableOpacity>
              <Text style={styles.taggedModalTitle}>Tagged for you</Text>
              <View style={{ width: 24 }} />
            </View>

            <Text style={styles.taggedModalHint}>Someone confessed their feelings to you 💌</Text>

            {/* List */}
            <FlatList
              data={taggedConfessions}
              keyExtractor={(item) => item.notificationId}
              renderItem={({ item }) => {
                // Handler to open thread and mark as seen
                const handleOpenTaggedConfession = () => {
                  if (item.isExpired) {
                    Alert.alert('Expired', 'This confession has expired.');
                    return;
                  }
                  // Mark as seen in demo mode
                  if (isDemoMode && !item.seen) {
                    markTaggedConfessionSeen(item.confessionId);
                  }
                  // Close modal and navigate
                  handleCloseTaggedSection();
                  handleOpenThread(item.confessionId);
                };

                return (
                  <TouchableOpacity
                    style={[styles.taggedConfessionCard, item.isExpired && styles.taggedConfessionCardExpired]}
                    onPress={handleOpenTaggedConfession}
                    activeOpacity={item.isExpired ? 1 : 0.7}
                  >
                    <View style={styles.taggedConfessionHeader}>
                      <View style={styles.taggedConfessionAvatar}>
                        <Ionicons name="eye-off" size={14} color={COLORS.textMuted} />
                      </View>
                      <Text style={styles.taggedConfessionAuthor}>Anonymous</Text>
                      <Text style={styles.taggedConfessionTime}>
                        {getTimeAgoSimple(item.confessionCreatedAt)}
                      </Text>
                      <View style={styles.forYouBadge}>
                        <Ionicons name="heart" size={9} color={COLORS.primary} />
                        <Text style={styles.forYouBadgeText}>For you</Text>
                      </View>
                      {!item.seen && !item.isExpired && (
                        <View style={styles.taggedUnseenDot} />
                      )}
                      {item.isExpired && (
                        <View style={styles.taggedExpiredBadge}>
                          <Text style={styles.taggedExpiredText}>Expired</Text>
                        </View>
                      )}
                      <View style={{ flex: 1 }} />
                      <TouchableOpacity
                        onPress={(e) => {
                          e.stopPropagation();
                          Alert.alert('Report Confession', 'Are you sure you want to report this confession?', [
                            { text: 'Report', style: 'destructive', onPress: () => handleReport(item.confessionId) },
                            { text: 'Cancel', style: 'cancel' },
                          ]);
                        }}
                        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                      >
                        <Ionicons name="ellipsis-horizontal" size={14} color={COLORS.textMuted} />
                      </TouchableOpacity>
                    </View>
                    <Text style={[styles.taggedConfessionText, item.isExpired && styles.taggedConfessionTextExpired]} numberOfLines={4}>
                      {item.confessionText}
                    </Text>
                    <View style={styles.taggedConfessionMeta}>
                      <View style={styles.taggedMetaItem}>
                        <Ionicons name="heart" size={12} color={COLORS.primary} />
                        <Text style={styles.taggedMetaText}>Confess-to: You</Text>
                      </View>
                      <View style={styles.taggedMetaItem}>
                        <Ionicons name="chatbubble-outline" size={12} color={COLORS.textMuted} />
                        <Text style={styles.taggedMetaCount}>{item.replyCount}</Text>
                      </View>
                    </View>
                  </TouchableOpacity>
                );
              }}
              contentContainerStyle={styles.taggedModalList}
              showsVerticalScrollIndicator={false}
              ListEmptyComponent={
                <View style={styles.taggedEmptyContainer}>
                  <Text style={styles.taggedEmptyText}>No tagged confessions yet</Text>
                </View>
              }
            />
          </View>
        </View>
      </Modal>
      </SafeAreaView>
    </LoadingGuard>
  );
}

// Helper function for tagged confessions time display
function getTimeAgoSimple(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
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
  headerButton: {
    padding: 4,
  },
  topHint: {
    fontSize: 12,
    color: COLORS.textLight,
    textAlign: 'center',
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 6,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingTop: 80,
    gap: 12,
  },
  loadingText: {
    fontSize: 16,
    color: COLORS.textLight,
    textAlign: 'center',
  },
  crushSection: {
    marginBottom: 4,
  },
  // Trending
  trendingSection: {
    marginBottom: 8,
    paddingTop: 8,
  },
  trendingSectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    marginBottom: 8,
  },
  trendingSectionTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: COLORS.text,
  },
  trendingHeroCard: {
    marginHorizontal: 10,
    borderRadius: 14,
    padding: 16,
    backgroundColor: COLORS.primary,
    marginBottom: 10,
  },
  trendingHeroText: {
    fontSize: 15,
    fontWeight: '600',
    lineHeight: 22,
    color: COLORS.white,
    marginBottom: 10,
  },
  trendingHeroTagLink: {
    color: COLORS.white,
    fontWeight: '700',
    textDecorationLine: 'underline',
  },
  trendingHeroMeta: {
    flexDirection: 'row',
    gap: 14,
  },
  trendingHeroStat: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  trendingHeroStatText: {
    fontSize: 12,
    fontWeight: '600',
    color: COLORS.white,
    opacity: 0.85,
  },
  listContent: {
    paddingTop: 4,
    paddingBottom: 96,
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: 40,
    marginTop: 80,
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
    marginBottom: 24,
  },
  emptyButton: {
    backgroundColor: COLORS.primary,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 24,
  },
  emptyButtonText: {
    fontSize: 15,
    fontWeight: '600',
    color: COLORS.white,
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
  // Composer modal styles
  composerOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
  composerSheet: {
    backgroundColor: COLORS.white,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    minHeight: SCREEN_HEIGHT * 0.5,
    maxHeight: SCREEN_HEIGHT * 0.85,
  },
  composerHandle: {
    width: 36,
    height: 4,
    backgroundColor: COLORS.border,
    borderRadius: 2,
    alignSelf: 'center',
    marginTop: 10,
    marginBottom: 6,
  },
  composerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.border,
  },
  composerTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: COLORS.text,
  },
  composerSubmitBtn: {
    backgroundColor: COLORS.primary,
    paddingHorizontal: 20,
    paddingVertical: 8,
    borderRadius: 20,
  },
  composerSubmitBtnDisabled: {
    backgroundColor: COLORS.border,
  },
  composerSubmitText: {
    color: COLORS.white,
    fontWeight: '700',
    fontSize: 14,
  },
  composerSubmitTextDisabled: {
    color: COLORS.textMuted,
  },
  composerSafetyBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: 'rgba(255,107,107,0.06)',
  },
  composerSafetyText: {
    fontSize: 12,
    color: COLORS.textMuted,
    fontWeight: '500',
  },
  composerInput: {
    fontSize: 16,
    lineHeight: 24,
    color: COLORS.text,
    paddingHorizontal: 16,
    paddingTop: 14,
    minHeight: 100,
    maxHeight: 160,
  },
  composerToolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.border,
  },
  composerCharCount: {
    fontSize: 12,
    color: COLORS.textMuted,
  },
  composerToggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  composerToggleInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
  },
  composerToggleLabel: {
    fontSize: 15,
    fontWeight: '600',
    color: COLORS.text,
  },
  composerToggleDesc: {
    fontSize: 12,
    color: COLORS.textMuted,
    marginTop: 2,
  },
  // Tagging styles
  tagSection: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.border,
  },
  tagHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 10,
  },
  tagLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.text,
  },
  tagInput: {
    fontSize: 14,
    color: COLORS.text,
    backgroundColor: COLORS.backgroundDark,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  tagHint: {
    fontSize: 12,
    color: COLORS.textMuted,
    marginTop: 6,
    fontStyle: 'italic',
  },
  tagHintSubtle: {
    fontSize: 11,
    color: COLORS.textMuted,
    marginTop: 6,
    opacity: 0.7,
  },
  taggedUserRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: 'rgba(255,107,107,0.08)',
    borderRadius: 10,
    padding: 10,
  },
  taggedLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: COLORS.primary,
  },
  taggedUserAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: COLORS.primary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  taggedUserAvatarImg: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: COLORS.backgroundDark,
  },
  taggedUserName: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.text,
  },
  taggedUserDisambiguator: {
    fontSize: 12,
    color: COLORS.textMuted,
    marginTop: 2,
  },
  suggestionsList: {
    marginTop: 8,
    backgroundColor: COLORS.white,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.border,
    overflow: 'hidden',
  },
  suggestionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.border,
  },
  suggestionAvatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: COLORS.primary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  suggestionName: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.text,
  },
  suggestionDisambiguator: {
    fontSize: 11,
    color: COLORS.textMuted,
    marginTop: 1,
  },
  // Duplicate picker styles
  duplicateOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  duplicateSheet: {
    backgroundColor: COLORS.white,
    borderRadius: 16,
    padding: 20,
    width: '100%',
    maxWidth: 340,
  },
  duplicateTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: COLORS.text,
    textAlign: 'center',
    marginBottom: 4,
  },
  duplicateSubtitle: {
    fontSize: 13,
    color: COLORS.textMuted,
    textAlign: 'center',
    marginBottom: 16,
  },
  duplicateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: COLORS.border,
  },
  duplicateAvatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: COLORS.primary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  duplicateAvatarImage: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: COLORS.backgroundDark,
  },
  duplicateName: {
    fontSize: 15,
    fontWeight: '600',
    color: COLORS.text,
  },
  duplicateDisambiguator: {
    fontSize: 12,
    color: COLORS.textMuted,
    marginTop: 2,
  },
  // Tagged for you section styles
  taggedForYouRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: 'rgba(255,107,107,0.08)',
    marginHorizontal: 10,
    marginTop: 8,
    marginBottom: 4,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 12,
  },
  taggedForYouLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  taggedForYouText: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.text,
  },
  taggedBadge: {
    backgroundColor: COLORS.primary,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 10,
    minWidth: 20,
    alignItems: 'center',
  },
  taggedBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: COLORS.white,
  },
  // Tagged modal styles
  taggedModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  taggedModalSheet: {
    flex: 1,
    backgroundColor: COLORS.backgroundDark,
    marginTop: 60,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
  },
  taggedModalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.border,
    backgroundColor: COLORS.white,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
  },
  taggedModalTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: COLORS.text,
  },
  taggedModalHint: {
    fontSize: 13,
    color: COLORS.textMuted,
    textAlign: 'center',
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  taggedModalList: {
    paddingBottom: 40,
  },
  taggedEmptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 40,
  },
  taggedEmptyText: {
    fontSize: 15,
    color: COLORS.textMuted,
  },
  taggedConfessionCard: {
    backgroundColor: 'rgba(255,107,107,0.04)', // Same highlight as ConfessionCard
    borderWidth: 1,
    borderColor: 'rgba(255,107,107,0.15)', // Soft border
    marginHorizontal: 10,
    marginVertical: 4,
    borderRadius: 12,
    padding: 12,
  },
  taggedConfessionCardExpired: {
    opacity: 0.6,
    backgroundColor: 'rgba(153,153,153,0.04)',
    borderColor: 'rgba(153,153,153,0.15)',
  },
  taggedUnseenDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: COLORS.primary,
    marginLeft: 6,
  },
  taggedConfessionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 8,
  },
  taggedConfessionAvatar: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: 'rgba(153,153,153,0.12)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  taggedConfessionAuthor: {
    fontSize: 12,
    fontWeight: '600',
    color: COLORS.text,
  },
  taggedConfessionTime: {
    fontSize: 11,
    color: COLORS.textMuted,
  },
  taggedExpiredBadge: {
    backgroundColor: 'rgba(153,153,153,0.15)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    marginLeft: 4,
  },
  taggedExpiredText: {
    fontSize: 10,
    fontWeight: '600',
    color: COLORS.textMuted,
  },
  taggedConfessionText: {
    fontSize: 14,
    lineHeight: 20,
    color: COLORS.text,
    marginBottom: 10,
  },
  taggedConfessionTextExpired: {
    color: COLORS.textMuted,
  },
  taggedConfessionMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  taggedMetaItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  taggedMetaText: {
    fontSize: 11,
    fontWeight: '600',
    color: COLORS.primary,
  },
  taggedMetaCount: {
    fontSize: 11,
    color: COLORS.textMuted,
  },
  forYouBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: 'rgba(255,107,107,0.1)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    marginLeft: 4,
  },
  forYouBadgeText: {
    fontSize: 10,
    fontWeight: '600',
    color: COLORS.primary,
  },
  // Profile preview confirmation modal styles
  previewConfirmOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  previewConfirmSheet: {
    backgroundColor: COLORS.white,
    borderRadius: 20,
    padding: 24,
    width: '100%',
    maxWidth: 320,
    alignItems: 'center',
  },
  previewConfirmIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: 'rgba(255,107,107,0.1)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  previewConfirmTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: COLORS.text,
    marginBottom: 8,
    textAlign: 'center',
  },
  previewConfirmDesc: {
    fontSize: 14,
    color: COLORS.textMuted,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 24,
  },
  previewConfirmActions: {
    flexDirection: 'row',
    gap: 12,
    width: '100%',
  },
  previewConfirmCancelBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: COLORS.backgroundDark,
    alignItems: 'center',
  },
  previewConfirmCancelText: {
    fontSize: 15,
    fontWeight: '600',
    color: COLORS.text,
  },
  previewConfirmViewBtn: {
    flex: 1,
    flexDirection: 'row',
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: COLORS.primary,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  previewConfirmViewText: {
    fontSize: 15,
    fontWeight: '600',
    color: COLORS.white,
  },
});
