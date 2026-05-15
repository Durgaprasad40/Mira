import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  FlatList,
  Modal,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMutation, useQuery } from 'convex/react';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import EmojiPicker from 'rn-emoji-keyboard';

import { safePush } from '@/lib/safeRouter';
import { api } from '@/convex/_generated/api';
import { COLORS, FONT_SIZE, SPACING, lineHeight, moderateScale } from '@/lib/constants';
import { CONFESSION_BLUR_PHOTO_RADIUS } from '@/lib/confessionBlur';
import { isProbablyEmoji } from '@/lib/utils';
import { isDemoMode } from '@/hooks/useConvex';
import { useScreenTrace } from '@/lib/devTrace';
import { useAuthStore } from '@/stores/authStore';
import { useBlockStore } from '@/stores/blockStore';
import { useConfessionStore } from '@/stores/confessionStore';
import { DraggableFab, DRAGGABLE_FAB_STORAGE_KEYS } from '@/components/common/DraggableFab';
import ConfessionCard from '@/components/confessions/ConfessionCard';
import { ConfessionMenuSheet } from '@/components/confessions/ConfessionMenuSheet';
import ConfessionUnderReviewBadge, {
  type ConfessionModerationStatus,
} from '@/components/confessions/ConfessionUnderReviewBadge';
import {
  ReportConfessionSheet,
  ReportReasonKey,
} from '@/components/confessions/ReportConfessionSheet';
import { HeaderAvatarButton } from '@/components/ui';
import { DEMO_CONFESSION_CONNECT_REQUESTS } from '@/lib/demoData';

type FeedConfession = {
  id: string;
  userId: string;
  text: string;
  isAnonymous: boolean;
  authorVisibility?: 'anonymous' | 'open' | 'blur_photo';
  mood: 'romantic' | 'spicy' | 'emotional' | 'funny';
  authorName?: string;
  authorPhotoUrl?: string;
  authorAge?: number;
  authorGender?: string;
  taggedUserId?: string;
  taggedUserName?: string;
  topEmojis: { emoji: string; count: number }[];
  replyPreviews: Array<{ text: string; isAnonymous: boolean; type: string; createdAt: number }>;
  replyCount: number;
  reactionCount: number;
  createdAt: number;
  moderationStatus?: ConfessionModerationStatus;
  isUnderReview?: boolean;
};

type TaggedConfessionItem = {
  notificationId: string;
  confessionId: string;
  seen: boolean;
  notificationCreatedAt: number;
  confessionText: string;
  confessionMood: string;
  confessionCreatedAt: number;
  confessionExpiresAt?: number;
  isExpired: boolean;
  replyCount: number;
  reactionCount: number;
  authorVisibility?: 'anonymous' | 'open' | 'blur_photo';
  authorName?: string;
  authorPhotoUrl?: string;
  authorAge?: number;
  authorGender?: string;
  taggedUserId?: string;
  taggedUserName?: string;
};

function getConfessGenderSymbol(gender?: string): { symbol: string; color: string } | null {
  if (!gender) return null;
  const normalized = gender.trim().toLowerCase();
  if (normalized === 'male' || normalized === 'm') return { symbol: '♂', color: '#4A90D9' };
  if (normalized === 'female' || normalized === 'f' || normalized === 'lesbian') {
    return { symbol: '♀', color: COLORS.primary };
  }
  return null;
}

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

function getReviewBadgeStatus(confession?: any): ConfessionModerationStatus {
  if (!confession) return undefined;
  if (
    confession.moderationStatus === 'under_review' ||
    confession.moderationStatus === 'hidden_by_reports'
  ) {
    return confession.moderationStatus;
  }
  return confession.isUnderReview ? 'under_review' : undefined;
}

export default function ConfessionsScreen() {
  useScreenTrace('CONFESSIONS');

  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { openTagged, openComposer } = useLocalSearchParams<{ openTagged?: string; openComposer?: string }>();
  const userId = useAuthStore((s) => s.userId);
  const token = useAuthStore((s) => s.token);
  const currentUserId = isDemoMode ? (userId || 'demo_user_1') : userId;

  const demoConfessions = useConfessionStore((s) => s.confessions);
  const demoUserReactions = useConfessionStore((s) => s.userReactions);
  const demoToggleReaction = useConfessionStore((s) => s.toggleReaction);
  const demoDeleteConfession = useConfessionStore((s) => s.deleteConfession);
  const demoReportConfession = useConfessionStore((s) => s.reportConfession);
  const demoCanPostConfession = useConfessionStore((s) => s.canPostConfession);
  const getTimeUntilNextConfession = useConfessionStore((s) => s.getTimeUntilNextConfession);
  const getMyLatestConfession = useConfessionStore((s) => s.getMyLatestConfession);
  const seenTaggedConfessionIds = useConfessionStore((s) => s.seenTaggedConfessionIds);
  const seenConfessionConnectRequestIds = useConfessionStore(
    (s) => s.seenConfessionConnectRequestIds
  );
  const markTaggedConfessionSeen = useConfessionStore((s) => s.markTaggedConfessionSeen);
  const markAllTaggedConfessionsSeen = useConfessionStore((s) => s.markAllTaggedConfessionsSeen);
  const markAllConfessionConnectRequestsSeen = useConfessionStore(
    (s) => s.markAllConfessionConnectRequestsSeen
  );

  const blockedUserIds = useBlockStore((s) => s.blockedUserIds);
  const blockUserLocal = useBlockStore((s) => s.blockUser);

  const convexCurrentUser = useQuery(
    api.users.getCurrentUser,
    !isDemoMode && token ? { token } : 'skip'
  );

  const liveConfessions = useQuery(
    api.confessions.listConfessions,
    !isDemoMode && token ? { sortBy: 'latest', token, viewerId: currentUserId ?? undefined } : 'skip'
  );
  const liveTrending = useQuery(
    api.confessions.getTrendingConfessions,
    !isDemoMode && token ? { token, viewerId: currentUserId ?? undefined } : 'skip'
  );
  const liveTaggedConfessions = useQuery(
    api.confessions.listTaggedConfessionsForUser,
    !isDemoMode && currentUserId && token ? { token, userId: currentUserId } : 'skip'
  );
  const liveConfessInboxBadge = useQuery(
    api.confessions.getConfessInboxBadgeCount,
    !isDemoMode && token ? { token } : 'skip'
  );
  const toggleReactionMutation = useMutation(api.confessions.toggleReaction);
  const reportConfessionMutation = useMutation(api.confessions.reportConfession);
  const deleteConfessionMutation = useMutation(api.confessions.deleteConfession);
  const markTaggedSeenMutation = useMutation(api.confessions.markTaggedConfessionsSeen);
  const consumeTagProfileViewGrantMutation = useMutation(
    api.confessions.consumeConfessionTagProfileViewGrant
  );
  const blockUserMutation = useMutation(api.users.blockUser);

  const [hiddenConfessionIds, setHiddenConfessionIds] = useState<string[]>([]);
  const [showTaggedSection, setShowTaggedSection] = useState(false);
  const [showReactionEmoji, setShowReactionEmoji] = useState(false);
  const [emojiTargetConfessionId, setEmojiTargetConfessionId] = useState<string | null>(null);
  const [liveUserReactions, setLiveUserReactions] = useState<Record<string, string | null>>({});
  const [refreshing, setRefreshing] = useState(false);
  const [showToast, setShowToast] = useState(false);
  const [toastMessage, setToastMessage] = useState('');
  const [showMenuSheet, setShowMenuSheet] = useState(false);
  const [menuTargetConfession, setMenuTargetConfession] = useState<{ id: string; authorId: string } | null>(null);
  const [reportingConfessionId, setReportingConfessionId] = useState<string | null>(null);
  const [countdownMs, setCountdownMs] = useState(0);
  const toastOpacity = useRef(new Animated.Value(0)).current;
  const pendingBlockAuthorsRef = useRef<Set<string>>(new Set());
  const refreshTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const effectiveViewerId = isDemoMode ? currentUserId : convexCurrentUser?._id;

  const showToastMessage = useCallback((message: string) => {
    setToastMessage(message);
    setShowToast(true);
    Animated.sequence([
      Animated.timing(toastOpacity, { toValue: 1, duration: 180, useNativeDriver: true }),
      Animated.delay(1800),
      Animated.timing(toastOpacity, { toValue: 0, duration: 180, useNativeDriver: true }),
    ]).start(() => setShowToast(false));
  }, [toastOpacity]);

  useEffect(() => {
    if (openTagged === 'true') {
      setShowTaggedSection(true);
    }
  }, [openTagged]);

  useEffect(() => {
    if (openComposer === 'true') {
      safePush(router, '/(main)/compose-confession' as any, 'confessions->compose');
    }
  }, [openComposer, router]);

  // Update countdown timer every second
  useEffect(() => {
    const updateCountdown = () => {
      if (isDemoMode) {
        setCountdownMs(getTimeUntilNextConfession());
      }
    };
    updateCountdown();
    const interval = setInterval(updateCountdown, 1000);
    return () => clearInterval(interval);
  }, [getTimeUntilNextConfession]);

  useEffect(() => {
    return () => {
      if (refreshTimeoutRef.current) {
        clearTimeout(refreshTimeoutRef.current);
      }
    };
  }, []);

  const confessions = useMemo<FeedConfession[]>(() => {
    const hiddenSet = new Set(hiddenConfessionIds);

    if (!isDemoMode) {
      if (!liveConfessions) return [];
      return liveConfessions
        .map((confession: any) => ({
          id: confession._id,
          userId: confession.userId,
          text: confession.text,
          isAnonymous: confession.isAnonymous,
          authorVisibility: confession.authorVisibility,
          mood: confession.mood,
          authorName: confession.authorName,
          authorPhotoUrl: confession.authorPhotoUrl,
          authorAge: confession.authorAge,
          authorGender: confession.authorGender,
          taggedUserId: confession.taggedUserId,
          taggedUserName: confession.taggedUserName,
          topEmojis: confession.topEmojis ?? [],
          replyPreviews: confession.replyPreviews ?? [],
          replyCount: confession.replyCount ?? 0,
          reactionCount: confession.reactionCount ?? 0,
          createdAt: confession.createdAt,
          moderationStatus: confession.moderationStatus,
          isUnderReview: confession.isUnderReview === true,
        }))
        .filter((confession: FeedConfession) => !blockedUserIds.includes(confession.userId))
        .filter((confession: FeedConfession) => !hiddenSet.has(confession.id));
    }

    const now = Date.now();
    return demoConfessions
      .filter((confession: any) => !confession.isDeleted)
      .filter((confession: any) => (confession.expiresAt ?? confession.createdAt + 24 * 60 * 60 * 1000) > now)
      .filter((confession: any) => !blockedUserIds.includes(confession.userId))
      .filter((confession: any) => !hiddenSet.has(confession.id))
      .sort((a: any, b: any) => b.createdAt - a.createdAt)
      .map((confession: any) => ({
        id: confession.id,
        userId: confession.userId,
        text: confession.text,
        isAnonymous: confession.isAnonymous,
        mood: confession.mood,
        authorName: confession.authorName,
        authorPhotoUrl: confession.authorPhotoUrl,
        authorAge: confession.authorAge,
        authorGender: confession.authorGender,
        taggedUserId: confession.taggedUserId,
        taggedUserName: confession.taggedUserName,
        topEmojis: confession.topEmojis ?? [],
        replyPreviews: confession.replyPreviews ?? [],
        replyCount: confession.replyCount ?? 0,
        reactionCount: confession.reactionCount ?? 0,
        createdAt: confession.createdAt,
      }));
  }, [blockedUserIds, demoConfessions, hiddenConfessionIds, liveConfessions]);

  const taggedConfessions = useMemo<TaggedConfessionItem[]>(() => {
    if (!currentUserId) return [];

    if (!isDemoMode) {
      return (liveTaggedConfessions ?? []).map((item: any) => ({
        notificationId: item.notificationId,
        confessionId: item.confessionId,
        seen: item.seen,
        notificationCreatedAt: item.notificationCreatedAt,
        confessionText: item.confessionText,
        confessionMood: item.confessionMood,
        confessionCreatedAt: item.confessionCreatedAt,
        confessionExpiresAt: item.confessionExpiresAt,
        isExpired: item.isExpired,
        replyCount: item.replyCount ?? 0,
        reactionCount: item.reactionCount ?? 0,
        authorVisibility: item.authorVisibility,
        authorName: item.authorName,
        authorPhotoUrl: item.authorPhotoUrl,
        authorAge: item.authorAge,
        authorGender: item.authorGender,
        taggedUserId: item.taggedUserId,
        taggedUserName: item.taggedUserName,
      }));
    }

    return demoConfessions
      .filter((confession: any) => confession.taggedUserId === currentUserId)
      .sort((a: any, b: any) => b.createdAt - a.createdAt)
      .map((confession: any) => {
        const expiresAt = confession.expiresAt ?? confession.createdAt + 24 * 60 * 60 * 1000;
        const taggedUserId = confession.taggedUserId;
        const taggedUserName = confession.taggedUserName;
        return {
          notificationId: confession.id,
          confessionId: confession.id,
          seen: seenTaggedConfessionIds.includes(confession.id),
          notificationCreatedAt: confession.createdAt,
          confessionText: confession.text,
          confessionMood: confession.mood,
          confessionCreatedAt: confession.createdAt,
          confessionExpiresAt: expiresAt,
          isExpired: expiresAt <= Date.now(),
          replyCount: confession.replyCount ?? 0,
          reactionCount: confession.reactionCount ?? 0,
          authorVisibility: confession.authorVisibility ?? (confession.isAnonymous ? 'anonymous' : 'open'),
          authorName: confession.authorName,
          authorPhotoUrl: confession.authorPhotoUrl,
          authorAge: confession.authorAge,
          authorGender: confession.authorGender,
          taggedUserId,
          taggedUserName,
        };
      });
  }, [currentUserId, demoConfessions, liveTaggedConfessions, seenTaggedConfessionIds]);

  const taggedBadgeCount = useMemo(() => {
    if (!isDemoMode) return liveConfessInboxBadge?.taggedCount ?? 0;
    return taggedConfessions.filter((item) => !item.seen && !item.isExpired).length;
  }, [isDemoMode, liveConfessInboxBadge?.taggedCount, taggedConfessions]);

  const pendingConnectBadgeCount = !isDemoMode
    ? (liveConfessInboxBadge?.pendingConnectCount ?? 0)
    : DEMO_CONFESSION_CONNECT_REQUESTS.filter(
        (request) => !seenConfessionConnectRequestIds.includes(request.connectId)
      ).length;

  const trendingHero = useMemo(() => {
    if (!isDemoMode) {
      const item = liveTrending?.[0];
      if (!item) return null;
      return {
        id: item._id,
        userId: item.userId,
        text: item.text,
        isAnonymous: item.isAnonymous,
        authorVisibility: item.authorVisibility, // P0-1: carry blur/identity through
        authorName: item.authorName,
        authorPhotoUrl: item.authorPhotoUrl,
        authorAge: item.authorAge,
        authorGender: item.authorGender,
        taggedUserId: item.taggedUserId,
        taggedUserName: item.taggedUserName,
        createdAt: item.createdAt,
        replyCount: item.replyCount ?? 0,
        reactionCount: item.reactionCount ?? 0,
      };
    }

    if (confessions.length === 0) return null;
    const now = Date.now();
    return [...confessions]
      .map((confession) => {
        const hoursSince = (now - confession.createdAt) / (1000 * 60 * 60);
        const score = (confession.replyCount * 5 + confession.reactionCount * 2) / (hoursSince + 2);
        return { ...confession, trendingScore: score };
      })
      .sort((a, b) => b.trendingScore - a.trendingScore)[0] ?? null;
  }, [confessions, isDemoMode, liveTrending]);

  // Get user's most recent confession (for "Your confession" section)
  const myLatestConfession = useMemo(() => {
    if (!currentUserId) return null;
    if (isDemoMode) {
      return getMyLatestConfession(currentUserId);
    }
    // For live mode, find from liveConfessions
    if (!liveConfessions) return null;
    const myConfessions = liveConfessions
      .filter((c: any) => c.userId === currentUserId)
      .sort((a: any, b: any) => b.createdAt - a.createdAt);
    return myConfessions[0] || null;
  }, [currentUserId, getMyLatestConfession, liveConfessions]);

  // Format countdown time
  const formatCountdown = useCallback((ms: number): string => {
    if (ms <= 0) return '';
    const hours = Math.floor(ms / (1000 * 60 * 60));
    const minutes = Math.floor((ms % (1000 * 60 * 60)) / (1000 * 60));
    if (hours > 0) {
      return `${hours}h ${minutes}m`;
    }
    return `${minutes}m`;
  }, []);

  const canPostNow = isDemoMode ? demoCanPostConfession() : true;

  // Get IDs to exclude from normal feed (prevent duplicates)
  const myConfessionId = myLatestConfession
    ? ((myLatestConfession as any).id || (myLatestConfession as any)._id)
    : null;
  const trendingConfessionId = trendingHero?.id || null;

  // Filter confessions to exclude trending and my confession (avoid duplicates)
  const filteredConfessions = useMemo(() => {
    const excludeIds = new Set<string>();
    if (myConfessionId) excludeIds.add(myConfessionId);
    if (trendingConfessionId) excludeIds.add(trendingConfessionId);
    return confessions.filter((c) => !excludeIds.has(c.id));
  }, [confessions, myConfessionId, trendingConfessionId]);

  const isLoading = !isDemoMode && (
    liveConfessions === undefined ||
    liveTrending === undefined ||
    (!!currentUserId && liveTaggedConfessions === undefined) ||
    (!!token && liveConfessInboxBadge === undefined)
  );

  const handleOpenComposer = useCallback(() => {
    // Check if user can post (1 confession per 24h limit)
    if (!canPostNow && countdownMs > 0) {
      showToastMessage(`You've already shared today. Try again in ${formatCountdown(countdownMs)}`);
      return;
    }

    safePush(router, '/(main)/compose-confession' as any, 'confessions->compose');
  }, [canPostNow, countdownMs, formatCountdown, router, showToastMessage]);

  const handleRefresh = useCallback(() => {
    setRefreshing(true);
    if (refreshTimeoutRef.current) {
      clearTimeout(refreshTimeoutRef.current);
    }
    refreshTimeoutRef.current = setTimeout(() => {
      setRefreshing(false);
    }, 450);
  }, []);

  const handleOpenTaggedSection = useCallback(() => {
    const unreadActiveTaggedConfessions = taggedConfessions.filter((item) => !item.seen && !item.isExpired);
    if (unreadActiveTaggedConfessions.length === 1) {
      const singleUnread = unreadActiveTaggedConfessions[0];
      if (!singleUnread) return;
      if (isDemoMode) {
        markTaggedConfessionSeen(singleUnread.confessionId);
      } else if (currentUserId) {
        markTaggedSeenMutation({
          token: token ?? '',
          userId: currentUserId,
          notificationIds: [singleUnread.notificationId as any],
        }).catch(() => {
          // Keep navigation usable even if badge clearing fails.
        });
      }
      setShowTaggedSection(false);
      safePush(
        router,
        {
          pathname: '/(main)/confession-thread',
          params: { confessionId: singleUnread.confessionId },
        } as any,
        'confessions->singleTaggedThread'
      );
      return;
    }

    setShowTaggedSection(true);
    if (!currentUserId) return;

    if (isDemoMode) {
      const unseenIds = unreadActiveTaggedConfessions.map((item) => item.confessionId);
      if (unseenIds.length > 0) {
        markAllTaggedConfessionsSeen(unseenIds);
      }
      return;
    }

    markTaggedSeenMutation({ token: token ?? '', userId: currentUserId }).catch(() => {
      // Keep the feed usable even if badge clearing fails.
    });
  }, [currentUserId, isDemoMode, markAllTaggedConfessionsSeen, markTaggedConfessionSeen, markTaggedSeenMutation, router, taggedConfessions, token]);

  const handleOpenConnectRequests = useCallback(() => {
    if (isDemoMode) {
      markAllConfessionConnectRequestsSeen(
        DEMO_CONFESSION_CONNECT_REQUESTS.map((request) => request.connectId)
      );
    }
    safePush(
      router,
      '/(main)/comment-connect-requests' as any,
      'confessions->connectRequests'
    );
  }, [markAllConfessionConnectRequestsSeen, router]);

  const handleOpenThread = useCallback((confessionId?: string | null) => {
    if (!confessionId) {
      if (__DEV__) {
        console.warn('[CONFESS_CARD_PRESS_BLOCKED_MISSING_ID]', { source: 'handleOpenThread' });
      }
      return;
    }
    safePush(
      router,
      {
        pathname: '/(main)/confession-thread',
        params: { confessionId },
      } as any,
      'confessions->thread'
    );
  }, [router]);

  const handleOpenMyConfessions = useCallback(() => {
    safePush(router, '/(main)/my-confessions' as any, 'confessions->myConfessions');
  }, [router]);

  // Open the tagged user's profile from a confession's @username chip.
  // Live mode: server validates the grant (expiry, mention match, blocks,
  // reports) and only on success we navigate. Demo mode: no backend call,
  // navigate directly so the demo UX still works.
  // Failure path uses a generic toast — never reveals block/report state.
  const handleTagPress = useCallback(async (
    confessionId: string,
    profileUserId: string | undefined
  ) => {
    if (!confessionId || !profileUserId) {
      return;
    }

    if (isDemoMode) {
      safePush(
        router,
        {
          pathname: '/(main)/profile/[id]',
          params: {
            id: profileUserId,
            source: 'confess_tag',
            mode: 'confess_preview',
            fromConfessionId: confessionId,
          },
        } as any,
        'confessions->profile(tag)'
      );
      return;
    }

    if (!token) {
      showToastMessage('Profile unavailable');
      return;
    }

    try {
      await consumeTagProfileViewGrantMutation({
        token,
        confessionId: confessionId as any,
        profileUserId: profileUserId as any,
      });
      safePush(
        router,
        {
          pathname: '/(main)/profile/[id]',
          params: {
            id: profileUserId,
            source: 'confess_tag',
            mode: 'confess_preview',
            fromConfessionId: confessionId,
          },
        } as any,
        'confessions->profile(tag)'
      );
    } catch {
      showToastMessage('Profile unavailable');
    }
  }, [consumeTagProfileViewGrantMutation, isDemoMode, router, showToastMessage, token]);

  const handleSelectTaggedConfession = useCallback((item: TaggedConfessionItem) => {
    if (item.isExpired) {
      Alert.alert('Expired', 'This confession has expired.');
      return;
    }

    if (isDemoMode && !item.seen) {
      markTaggedConfessionSeen(item.confessionId);
    }

    setShowTaggedSection(false);
    handleOpenThread(item.confessionId);
  }, [handleOpenThread, isDemoMode, markTaggedConfessionSeen]);

  const toggleReaction = useCallback(async (confessionId: string, emoji: string) => {
    if (!currentUserId) return;

    if (isDemoMode) {
      demoToggleReaction(confessionId, emoji, currentUserId);
      return;
    }

    setLiveUserReactions((current) => {
      const next = { ...current };
      next[confessionId] = next[confessionId] === emoji ? null : emoji;
      return next;
    });

    try {
      await toggleReactionMutation({
        confessionId: confessionId as any,
        token: token ?? '',
        userId: currentUserId,
        type: emoji,
      });
    } catch {
      setLiveUserReactions((current) => {
        const next = { ...current };
        delete next[confessionId];
        return next;
      });
      Alert.alert('Unable to react right now');
    }
  }, [currentUserId, demoToggleReaction, isDemoMode, toggleReactionMutation, token]);

  const handleOpenReactionPicker = useCallback((confessionId: string) => {
    setEmojiTargetConfessionId(confessionId);
    setShowReactionEmoji(true);
  }, []);

  const handleReactionEmojiSelected = useCallback((emoji: any) => {
    if (!emojiTargetConfessionId) return;
    void toggleReaction(emojiTargetConfessionId, emoji.emoji);
  }, [emojiTargetConfessionId, toggleReaction]);

  const handleDeleteConfession = useCallback((confessionId: string, authorId: string) => {
    if (!effectiveViewerId || authorId !== effectiveViewerId) {
      return;
    }

    Alert.alert('Delete Confession', 'This action cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          if (isDemoMode) {
            demoDeleteConfession(confessionId);
            setHiddenConfessionIds((current) => current.includes(confessionId) ? current : [...current, confessionId]);
            return;
          }

          if (!currentUserId) return;

          setHiddenConfessionIds((current) => current.includes(confessionId) ? current : [...current, confessionId]);
          try {
            await deleteConfessionMutation({
              confessionId: confessionId as any,
              token: token ?? '',
              userId: currentUserId,
            });
          } catch {
            setHiddenConfessionIds((current) => current.filter((id) => id !== confessionId));
            Alert.alert('Unable to delete right now');
          }
        },
      },
    ]);
  }, [currentUserId, deleteConfessionMutation, demoDeleteConfession, effectiveViewerId, isDemoMode, token]);

  const handleSubmitReport = useCallback(async (
    confessionId: string,
    reason: ReportReasonKey
  ) => {
    if (isDemoMode) {
      demoReportConfession(confessionId);
      setHiddenConfessionIds((current) => current.includes(confessionId) ? current : [...current, confessionId]);
      showToastMessage("Thanks. We'll review this confession.");
      return;
    }

    if (!currentUserId) return;

    try {
      await reportConfessionMutation({
        confessionId: confessionId as any,
        token: token ?? '',
        reporterId: currentUserId,
        reason,
      });
      setHiddenConfessionIds((current) => current.includes(confessionId) ? current : [...current, confessionId]);
      showToastMessage("Thanks. We'll review this confession.");
    } catch {
      Alert.alert('Unable to report right now');
    }
  }, [currentUserId, demoReportConfession, isDemoMode, reportConfessionMutation, showToastMessage, token]);

  const handleBlockAuthor = useCallback(async (authorId: string) => {
    if (!currentUserId || !authorId) return;

    if (isDemoMode) {
      blockUserLocal(authorId);
      return;
    }

    if (pendingBlockAuthorsRef.current.has(authorId)) return;
    pendingBlockAuthorsRef.current.add(authorId);

    try {
      if (!token || !currentUserId) {
        Alert.alert('Unable to block user right now');
        return;
      }
      // P1-3: backend now requires (token, authUserId).
      await blockUserMutation({
        token,
        authUserId: currentUserId,
        blockedUserId: authorId as any,
      });
      blockUserLocal(authorId);
    } catch {
      Alert.alert('Unable to block user right now');
    } finally {
      pendingBlockAuthorsRef.current.delete(authorId);
    }
  }, [blockUserLocal, blockUserMutation, currentUserId, isDemoMode, token]);

  // Open the premium menu sheet instead of alert
  const handleOpenMenuSheet = useCallback((confessionId: string, authorId: string) => {
    setMenuTargetConfession({ id: confessionId, authorId });
    setShowMenuSheet(true);
  }, []);

  const handleCloseMenuSheet = useCallback(() => {
    setShowMenuSheet(false);
    setMenuTargetConfession(null);
  }, []);

  const handleMenuDelete = useCallback(() => {
    if (!menuTargetConfession) return;
    handleDeleteConfession(menuTargetConfession.id, menuTargetConfession.authorId);
  }, [handleDeleteConfession, menuTargetConfession]);

  const handleMenuReport = useCallback(() => {
    if (!menuTargetConfession) return;
    setReportingConfessionId(menuTargetConfession.id);
  }, [menuTargetConfession]);

  const handleSubmitReportSheet = useCallback(async (reason: ReportReasonKey) => {
    const confessionId = reportingConfessionId;
    if (!confessionId) return;
    setReportingConfessionId(null);
    await handleSubmitReport(confessionId, reason);
  }, [handleSubmitReport, reportingConfessionId]);

  const handleMenuEdit = useCallback(() => {
    if (!menuTargetConfession) {
      return;
    }
    // Navigate to compose-confession in edit mode
    // The compose-confession screen handles all edit logic including:
    // - fetching existing confession data
    // - prefilling form fields
    // - update mutation
    safePush(
      router,
      {
        pathname: '/(main)/compose-confession',
        params: {
          editId: menuTargetConfession.id,
          mode: 'edit',
        },
      } as any,
      'confessions->editConfession'
    );
  }, [menuTargetConfession, router]);

  const renderHeader = useCallback(() => (
    <View>
      {/* 1. TRENDING SECTION (always first) - Premium card with full border */}
      {trendingHero && (() => {
        // P0-1: Derive effective visibility (matches ConfessionCard logic)
        const trendingVisibility = (trendingHero as any).authorVisibility
          || (trendingHero.isAnonymous ? 'anonymous' : 'open');
        const trendingIsAnonymous = trendingVisibility === 'anonymous';
        const trendingIsBlurPhoto = trendingVisibility === 'blur_photo' || trendingVisibility === 'blur';
        const trendingGenderSymbol = getConfessGenderSymbol(trendingHero.authorGender);
        const trendingTaggedUserId = (trendingHero as any).taggedUserId as string | undefined;
        const trendingTaggedUserName = ((trendingHero as any).taggedUserName as string | undefined)?.trim();
        return (
        <TouchableOpacity
          style={styles.trendingCard}
          activeOpacity={0.88}
          onPress={() => {
            handleOpenThread(trendingHero.id);
          }}
          onLongPress={() => handleOpenMenuSheet(trendingHero.id, trendingHero.userId)}
          delayLongPress={300}
        >
          {/* Trending badge */}
          <View style={styles.trendingBadge}>
            <Ionicons name="trending-up" size={12} color="#B8860B" />
            <Text maxFontSizeMultiplier={1.2} style={styles.trendingBadgeText}>Trending</Text>
          </View>

          {/* Author row - shows identity with gender symbol */}
          <View style={styles.trendingAuthorRow}>
            {trendingIsAnonymous ? (
              <View style={[styles.trendingAvatar, styles.trendingAvatarAnonymous]}>
                <Ionicons name="eye-off" size={10} color={COLORS.textMuted} />
              </View>
            ) : trendingIsBlurPhoto && trendingHero.authorPhotoUrl ? (
              <Image
                source={{ uri: trendingHero.authorPhotoUrl }}
                style={styles.trendingAvatarImage}
                contentFit="cover"
                blurRadius={CONFESSION_BLUR_PHOTO_RADIUS}
              />
            ) : trendingHero.authorPhotoUrl ? (
              <Image
                source={{ uri: trendingHero.authorPhotoUrl }}
                style={styles.trendingAvatarImage}
                contentFit="cover"
              />
            ) : (
              <View style={styles.trendingAvatar}>
                <Ionicons name="person" size={10} color={COLORS.primary} />
              </View>
            )}
            <View style={styles.trendingIdentityText}>
              <Text
                maxFontSizeMultiplier={1.2}
                style={[styles.trendingAuthorName, !trendingIsAnonymous && styles.trendingAuthorNamePublic]}
                numberOfLines={1}
              >
                {trendingIsAnonymous ? 'Anonymous' : trendingHero.authorName || 'Someone'}
              </Text>
              {!trendingIsAnonymous && trendingHero.authorAge ? (
                <Text maxFontSizeMultiplier={1.2} style={styles.trendingAuthorAge}>
                  , {trendingHero.authorAge}
                </Text>
              ) : null}
              {trendingGenderSymbol ? (
                <Text
                  maxFontSizeMultiplier={1.2}
                  style={[styles.genderSymbol, { color: trendingGenderSymbol.color }]}
                >
                  {trendingGenderSymbol.symbol}
                </Text>
              ) : null}
            </View>
            <Text maxFontSizeMultiplier={1.2} style={styles.trendingTime}>{getTimeAgoSimple(trendingHero.createdAt)}</Text>
          </View>

          {/* Confession text */}
          <Text maxFontSizeMultiplier={1.2} style={styles.trendingText} numberOfLines={3}>{trendingHero.text}</Text>

          {trendingTaggedUserId && trendingTaggedUserName ? (
            <TouchableOpacity
              style={styles.heroTaggedRow}
              onPress={(event) => {
                event.stopPropagation?.();
                void handleTagPress(trendingHero.id, trendingTaggedUserId);
              }}
              activeOpacity={0.7}
            >
              <Ionicons name="heart" size={12} color={COLORS.primary} />
              <Text maxFontSizeMultiplier={1.2} style={styles.heroTaggedLabel}>Confess-to:</Text>
              <Text maxFontSizeMultiplier={1.2} style={styles.heroTaggedName} numberOfLines={1}>
                {trendingTaggedUserName}
              </Text>
            </TouchableOpacity>
          ) : null}

          {/* Meta row */}
          <View style={styles.trendingMeta}>
            <View style={styles.trendingMetaItem}>
              <Ionicons name="chatbubble-outline" size={12} color={COLORS.textMuted} />
              <Text maxFontSizeMultiplier={1.2} style={styles.trendingMetaText}>{trendingHero.replyCount}</Text>
            </View>
            <View style={styles.trendingMetaItem}>
              <Ionicons name="heart-outline" size={12} color={COLORS.textMuted} />
              <Text maxFontSizeMultiplier={1.2} style={styles.trendingMetaText}>{trendingHero.reactionCount}</Text>
            </View>
          </View>
        </TouchableOpacity>
        );
      })()}

      {/* 2. MY CONFESSION SECTION (second, owner only) - Border highlight only */}
      {myLatestConfession && (() => {
        // P0-1: Derive effective visibility (matches ConfessionCard logic)
        const myAny = myLatestConfession as any;
        const myVisibility = myAny.authorVisibility
          || (myAny.isAnonymous ? 'anonymous' : 'open');
        const myIsAnonymous = myVisibility === 'anonymous';
        const myIsBlurPhoto = myVisibility === 'blur_photo' || myVisibility === 'blur';
        const myGenderSymbol = getConfessGenderSymbol((myLatestConfession as any).authorGender);
        const reviewStatus = getReviewBadgeStatus(myAny);
        const myConfessionId = myAny.id || myAny._id;
        const myTaggedUserId = myAny.taggedUserId as string | undefined;
        const myTaggedUserName = (myAny.taggedUserName as string | undefined)?.trim();
        return (
        <TouchableOpacity
          style={styles.myConfessionCard}
          activeOpacity={0.88}
          onPress={() => {
            handleOpenThread(myConfessionId);
          }}
          onLongPress={() => handleOpenMenuSheet(
            myConfessionId,
            (myLatestConfession as any).userId
          )}
          delayLongPress={300}
        >
          {reviewStatus ? (
            <View style={styles.myConfessionReviewBadge}>
              <ConfessionUnderReviewBadge status={reviewStatus} />
            </View>
          ) : null}

          {/* Author row - same as normal cards */}
          <View style={styles.myConfessionAuthorRow}>
            {myIsAnonymous ? (
              <View style={[styles.myConfessionAvatar, styles.myConfessionAvatarAnonymous]}>
                <Ionicons name="eye-off" size={10} color={COLORS.textMuted} />
              </View>
            ) : myIsBlurPhoto && (myLatestConfession as any).authorPhotoUrl ? (
              <Image
                source={{ uri: (myLatestConfession as any).authorPhotoUrl }}
                style={styles.myConfessionAvatarImage}
                contentFit="cover"
                blurRadius={CONFESSION_BLUR_PHOTO_RADIUS}
              />
            ) : (myLatestConfession as any).authorPhotoUrl ? (
              <Image
                source={{ uri: (myLatestConfession as any).authorPhotoUrl }}
                style={styles.myConfessionAvatarImage}
                contentFit="cover"
              />
            ) : (
              <View style={styles.myConfessionAvatar}>
                <Ionicons name="person" size={10} color={COLORS.primary} />
              </View>
            )}
            <View style={styles.myConfessionIdentityText}>
              <Text
                maxFontSizeMultiplier={1.2}
                style={[styles.myConfessionAuthorName, !myIsAnonymous && styles.myConfessionAuthorNamePublic]}
                numberOfLines={1}
              >
                {myIsAnonymous ? 'Anonymous' : (myLatestConfession as any).authorName || 'You'}
              </Text>
              {!myIsAnonymous && (myLatestConfession as any).authorAge ? (
                <Text maxFontSizeMultiplier={1.2} style={styles.myConfessionAuthorAge}>
                  , {(myLatestConfession as any).authorAge}
                </Text>
              ) : null}
              {myGenderSymbol ? (
                <Text
                  maxFontSizeMultiplier={1.2}
                  style={[styles.genderSymbol, { color: myGenderSymbol.color }]}
                >
                  {myGenderSymbol.symbol}
                </Text>
              ) : null}
            </View>
            <Text maxFontSizeMultiplier={1.2} style={styles.myConfessionTime}>{getTimeAgoSimple(myLatestConfession.createdAt)}</Text>
          </View>

          {/* Confession text */}
          <Text maxFontSizeMultiplier={1.2} style={styles.myConfessionText} numberOfLines={2}>
            {myLatestConfession.text}
          </Text>

          {myConfessionId && myTaggedUserId && myTaggedUserName ? (
            <TouchableOpacity
              style={styles.heroTaggedRow}
              onPress={(event) => {
                event.stopPropagation?.();
                void handleTagPress(myConfessionId, myTaggedUserId);
              }}
              activeOpacity={0.7}
            >
              <Ionicons name="heart" size={12} color={COLORS.primary} />
              <Text maxFontSizeMultiplier={1.2} style={styles.heroTaggedLabel}>Confess-to:</Text>
              <Text maxFontSizeMultiplier={1.2} style={styles.heroTaggedName} numberOfLines={1}>
                {myTaggedUserName}
              </Text>
            </TouchableOpacity>
          ) : null}

          {/* Meta row */}
          <View style={styles.myConfessionMeta}>
            <View style={styles.myConfessionMetaItem}>
              <Ionicons name="chatbubble-outline" size={12} color={COLORS.textMuted} />
              <Text maxFontSizeMultiplier={1.2} style={styles.myConfessionMetaText}>{myLatestConfession.replyCount ?? 0}</Text>
            </View>
            <View style={styles.myConfessionMetaItem}>
              <Ionicons name="heart-outline" size={12} color={COLORS.textMuted} />
              <Text maxFontSizeMultiplier={1.2} style={styles.myConfessionMetaText}>{myLatestConfession.reactionCount ?? 0}</Text>
            </View>
          </View>
        </TouchableOpacity>
        );
      })()}

      {/* Countdown notice when limit is reached */}
      {!canPostNow && countdownMs > 0 && (
        <View style={styles.countdownNotice}>
          <Ionicons name="time-outline" size={14} color={COLORS.textMuted} />
          <Text maxFontSizeMultiplier={1.2} style={styles.countdownText}>
            Next confession in {formatCountdown(countdownMs)}
          </Text>
        </View>
      )}

      {/* Tagged for you section */}
      {taggedConfessions.length > 0 && (
        <TouchableOpacity style={styles.taggedRow} onPress={handleOpenTaggedSection} activeOpacity={0.8}>
          <View style={styles.taggedRowLeft}>
            <Ionicons name="heart" size={18} color={COLORS.primary} />
            <Text maxFontSizeMultiplier={1.2} style={styles.taggedRowText}>Tagged for you</Text>
            {taggedBadgeCount > 0 && (
              <View style={styles.badge}>
                <Text maxFontSizeMultiplier={1.2} style={styles.badgeText}>{taggedBadgeCount}</Text>
              </View>
            )}
          </View>
          <Ionicons name="chevron-forward" size={18} color={COLORS.textMuted} />
        </TouchableOpacity>
      )}

      {pendingConnectBadgeCount > 0 && (
        <TouchableOpacity style={styles.connectRequestsRow} onPress={handleOpenConnectRequests} activeOpacity={0.84}>
          <View style={styles.taggedRowLeft}>
            <Ionicons name="person-add" size={18} color={COLORS.primary} />
            <View style={styles.connectRequestsTextGroup}>
              <Text maxFontSizeMultiplier={1.2} style={styles.taggedRowText}>Connect requests</Text>
              <Text maxFontSizeMultiplier={1.2} style={styles.connectRequestsSubtitle}>
                People who want to connect from your confessions
              </Text>
            </View>
            <View style={styles.badge}>
              <Text maxFontSizeMultiplier={1.2} style={styles.badgeText}>{pendingConnectBadgeCount}</Text>
            </View>
          </View>
          <Ionicons name="chevron-forward" size={18} color={COLORS.textMuted} />
        </TouchableOpacity>
      )}
    </View>
  ), [canPostNow, countdownMs, formatCountdown, handleOpenConnectRequests, handleOpenTaggedSection, handleOpenMenuSheet, handleOpenThread, handleTagPress, myLatestConfession, pendingConnectBadgeCount, taggedBadgeCount, taggedConfessions.length, trendingHero]);

  if (isLoading && confessions.length === 0) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.header}>
          <Ionicons name="megaphone" size={16} color={COLORS.primary} />
          <Text maxFontSizeMultiplier={1.2} style={styles.headerTitle}>Confess</Text>
        </View>
        <View style={styles.loadingState}>
          <ActivityIndicator size="large" color={COLORS.primary} />
          <Text maxFontSizeMultiplier={1.2} style={styles.loadingText}>Loading confessions...</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <Ionicons name="megaphone" size={16} color={COLORS.primary} />
        <Text maxFontSizeMultiplier={1.2} style={styles.headerTitle}>Confess</Text>
        <View style={{ flex: 1 }} />
        <View style={styles.headerRightGroup}>
          <TouchableOpacity
            onPress={handleOpenMyConfessions}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            style={styles.headerButton}
          >
            <Ionicons name="document-text-outline" size={18} color={COLORS.text} />
          </TouchableOpacity>
          <HeaderAvatarButton />
        </View>
      </View>

      <FlatList
        data={filteredConfessions}
        keyExtractor={(item) => item.id}
        ListHeaderComponent={renderHeader}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            tintColor={COLORS.primary}
            colors={[COLORS.primary]}
          />
        }
        renderItem={({ item }) => {
          const userEmoji = isDemoMode
            ? (demoUserReactions[item.id] && isProbablyEmoji(demoUserReactions[item.id]!) ? demoUserReactions[item.id]! : null)
            : (liveUserReactions[item.id] ?? null);
          const isTaggedForMe = item.taggedUserId != null && item.taggedUserId === effectiveViewerId;
          const isOwnerCard = item.userId === effectiveViewerId;
          const reviewStatus = isOwnerCard ? getReviewBadgeStatus(item) : undefined;

          return (
            <View>
              {reviewStatus ? (
                <View style={styles.feedReviewBadgeWrap}>
                  <ConfessionUnderReviewBadge status={reviewStatus} />
                </View>
              ) : null}
              <ConfessionCard
                id={item.id}
                text={item.text}
                isAnonymous={item.isAnonymous}
                authorVisibility={item.authorVisibility}
                mood={item.mood}
                topEmojis={item.topEmojis}
                userEmoji={userEmoji}
                replyPreviews={item.replyPreviews}
                replyCount={item.replyCount}
                reactionCount={item.reactionCount}
                authorName={item.authorName}
                authorPhotoUrl={item.authorPhotoUrl}
                authorAge={item.authorAge}
                authorGender={item.authorGender}
                createdAt={item.createdAt}
                isTaggedForMe={isTaggedForMe}
                taggedUserId={item.taggedUserId}
                taggedUserName={item.taggedUserName}
                authorId={item.userId}
                viewerId={effectiveViewerId ?? undefined}
                // EXPLICIT INTERACTION CONTRACT for main feed (/confessions)
                screenContext="confessions"
                enableTapToOpenThread={true}
                enableLongPressMenu={true}
                onCardPress={() => handleOpenThread(item.id)}
                onCardLongPress={() => handleOpenMenuSheet(item.id, item.userId)}
                onReact={() => handleOpenReactionPicker(item.id)}
                onToggleEmoji={(emoji) => void toggleReaction(item.id, emoji)}
                onTagPress={
                  item.taggedUserId
                    ? () => void handleTagPress(item.id, item.taggedUserId)
                    : undefined
                }
              />
            </View>
          );
        }}
        ListEmptyComponent={
          // Only show empty state if NO confessions exist at all (not just filtered list)
          confessions.length === 0 ? (
            <View style={styles.emptyState}>
              <View style={styles.emptyHeroIconRing}>
                <Ionicons name="megaphone" size={moderateScale(32, 0.4)} color={COLORS.primary} />
              </View>
              <Text maxFontSizeMultiplier={1.2} style={styles.emptyTitle}>Say it your way</Text>
              <Text maxFontSizeMultiplier={1.2} style={styles.emptySubtitle}>
                Confess a feeling, a crush, a funny thought, a secret, or a campus moment — anything you want to say out loud or indirectly.
              </Text>

              <View style={styles.emptyHeroSteps}>
                <View style={styles.emptyHeroStepRow}>
                  <View style={styles.emptyHeroStepIconWrap}>
                    <Ionicons name="chatbubble-ellipses-outline" size={16} color={COLORS.primary} />
                  </View>
                  <View style={styles.emptyHeroStepText}>
                    <Text maxFontSizeMultiplier={1.2} style={styles.emptyHeroStepLabel}>
                      Post freely
                    </Text>
                    <Text maxFontSizeMultiplier={1.2} style={styles.emptyHeroStepDesc}>
                      Tagging someone is optional — you can confess without mentioning anyone.
                    </Text>
                  </View>
                </View>
                <View style={styles.emptyHeroStepRow}>
                  <View style={styles.emptyHeroStepIconWrap}>
                    <Ionicons name="heart-outline" size={16} color={COLORS.primary} />
                  </View>
                  <View style={styles.emptyHeroStepText}>
                    <Text maxFontSizeMultiplier={1.2} style={styles.emptyHeroStepLabel}>
                      Mention a crush
                    </Text>
                    <Text maxFontSizeMultiplier={1.2} style={styles.emptyHeroStepDesc}>
                      Liked someone? You can mention that person in your confession.
                    </Text>
                  </View>
                </View>
                <View style={styles.emptyHeroStepRow}>
                  <View style={styles.emptyHeroStepIconWrap}>
                    <Ionicons name="eye-off-outline" size={16} color={COLORS.primary} />
                  </View>
                  <View style={styles.emptyHeroStepText}>
                    <Text maxFontSizeMultiplier={1.2} style={styles.emptyHeroStepLabel}>
                      You stay in control
                    </Text>
                    <Text maxFontSizeMultiplier={1.2} style={styles.emptyHeroStepDesc}>
                      Post anonymously or as yourself — your call on every confession.
                    </Text>
                  </View>
                </View>
              </View>

              <TouchableOpacity
                style={styles.emptyButton}
                onPress={handleOpenComposer}
                activeOpacity={0.9}
                accessibilityRole="button"
                accessibilityLabel="Post a Confession"
              >
                <Ionicons name="sparkles" size={16} color={COLORS.white} />
                <Text maxFontSizeMultiplier={1.2} style={styles.emptyButtonText}>Post a Confession</Text>
              </TouchableOpacity>
            </View>
          ) : null
        }
      />

      {showToast && (
        <Animated.View style={[styles.toast, { opacity: toastOpacity }]}>
          <Ionicons name="checkmark-circle" size={18} color="#34C759" />
          <Text maxFontSizeMultiplier={1.2} style={styles.toastText}>{toastMessage}</Text>
        </Animated.View>
      )}

      {/* Draggable composer FAB. Tap opens the composer; drag moves the
          button and snaps to the nearest screen edge on release. Position
          is persisted under a Confess-specific storage key so it never
          collides with the Phase-2 Truth or Dare FAB. */}
      <DraggableFab
        storageKey={DRAGGABLE_FAB_STORAGE_KEYS.confessComposer}
        buttonSize={52}
        defaultRight={16}
        defaultBottom={Math.max(insets.bottom, 16) + 8}
        topInset={insets.top + 60}
        bottomInset={Math.max(insets.bottom, 16) + 8}
        positionStyle={[styles.fabPosition, { bottom: Math.max(insets.bottom, 16) + 8 }]}
        touchableStyle={[styles.fab, !canPostNow && styles.fabDisabled]}
        activeOpacity={canPostNow ? 0.8 : 0.9}
        onPress={handleOpenComposer}
        accessibilityLabel="Post a confession"
      >
        <Ionicons name="add" size={24} color={COLORS.white} />
      </DraggableFab>

      {/* Premium menu sheet for confession actions */}
      <ConfessionMenuSheet
        visible={showMenuSheet}
        isOwner={menuTargetConfession?.authorId === effectiveViewerId}
        onClose={handleCloseMenuSheet}
        onEdit={handleMenuEdit}
        onDelete={handleMenuDelete}
        onReport={handleMenuReport}
      />

      <ReportConfessionSheet
        visible={reportingConfessionId !== null}
        mode="confession"
        onClose={() => setReportingConfessionId(null)}
        onSubmit={handleSubmitReportSheet}
      />

      <EmojiPicker
        open={showReactionEmoji}
        onClose={() => {
          setShowReactionEmoji(false);
          setEmojiTargetConfessionId(null);
        }}
        onEmojiSelected={handleReactionEmojiSelected}
      />

      <Modal visible={showTaggedSection} transparent animationType="slide" onRequestClose={() => setShowTaggedSection(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.taggedSheet}>
            <View style={styles.taggedSheetHeader}>
              <TouchableOpacity onPress={() => setShowTaggedSection(false)}>
                <Ionicons name="chevron-back" size={24} color={COLORS.text} />
              </TouchableOpacity>
              <Text maxFontSizeMultiplier={1.2} style={styles.taggedSheetTitle}>Tagged for you</Text>
              <View style={{ width: 24 }} />
            </View>

            <Text maxFontSizeMultiplier={1.2} style={styles.taggedSheetHint}>Someone confessed their feelings to you 💌</Text>

            <FlatList
              data={taggedConfessions}
              keyExtractor={(item) => item.notificationId}
              contentContainerStyle={styles.taggedList}
              showsVerticalScrollIndicator={false}
              renderItem={({ item }) => {
                const taggedAuthorVisibility = item.authorVisibility ?? 'anonymous';
                const taggedAuthorIsAnonymous = taggedAuthorVisibility === 'anonymous';
                const taggedAuthorIsBlurPhoto =
                  (taggedAuthorVisibility as string) === 'blur_photo' ||
                  (taggedAuthorVisibility as string) === 'blur';
                const taggedAuthorGenderSymbol = taggedAuthorIsAnonymous
                  ? null
                  : getConfessGenderSymbol(item.authorGender);
                const taggedAuthorDisplayName = taggedAuthorIsAnonymous
                  ? 'Anonymous'
                  : item.authorName || 'Someone';

                return (
                  <TouchableOpacity
                    style={[styles.taggedCard, item.isExpired && styles.taggedCardExpired]}
                    activeOpacity={item.isExpired ? 1 : 0.82}
                    onPress={() => handleSelectTaggedConfession(item)}
                  >
                    <View style={styles.taggedCardHeader}>
                      <View style={styles.taggedAuthorIdentity}>
                        {taggedAuthorIsAnonymous ? (
                          <View style={[styles.taggedAuthorAvatar, styles.taggedAuthorAvatarAnonymous]}>
                            <Ionicons name="eye-off" size={10} color={COLORS.textMuted} />
                          </View>
                        ) : taggedAuthorIsBlurPhoto && item.authorPhotoUrl ? (
                          <Image
                            source={{ uri: item.authorPhotoUrl }}
                            style={styles.taggedAuthorAvatarImage}
                            contentFit="cover"
                            blurRadius={CONFESSION_BLUR_PHOTO_RADIUS}
                          />
                        ) : item.authorPhotoUrl ? (
                          <Image
                            source={{ uri: item.authorPhotoUrl }}
                            style={styles.taggedAuthorAvatarImage}
                            contentFit="cover"
                          />
                        ) : (
                          <View style={styles.taggedAuthorAvatar}>
                            <Ionicons name="person" size={10} color={COLORS.primary} />
                          </View>
                        )}
                        <View style={styles.taggedAuthorIdentityText}>
                          <Text
                            maxFontSizeMultiplier={1.2}
                            style={[
                              styles.taggedCardAuthor,
                              !taggedAuthorIsAnonymous && styles.taggedCardAuthorPublic,
                            ]}
                            numberOfLines={1}
                          >
                            {taggedAuthorDisplayName}
                          </Text>
                          {!taggedAuthorIsAnonymous && item.authorAge ? (
                            <Text maxFontSizeMultiplier={1.2} style={styles.taggedAuthorAge}>
                              , {item.authorAge}
                            </Text>
                          ) : null}
                          {taggedAuthorGenderSymbol ? (
                            <Text
                              maxFontSizeMultiplier={1.2}
                              style={[
                                styles.taggedAuthorGenderSymbol,
                                { color: taggedAuthorGenderSymbol.color },
                              ]}
                            >
                              {taggedAuthorGenderSymbol.symbol}
                            </Text>
                          ) : null}
                        </View>
                        {taggedAuthorIsBlurPhoto ? (
                          <View style={styles.taggedBlurBadge}>
                            <Ionicons name="eye-off-outline" size={10} color={COLORS.textMuted} />
                          </View>
                        ) : null}
                      </View>
                      <Text maxFontSizeMultiplier={1.2} style={styles.taggedCardTime}>{getTimeAgoSimple(item.confessionCreatedAt)}</Text>
                      {!item.seen && !item.isExpired && <View style={styles.unseenDot} />}
                      {item.isExpired && (
                        <View style={styles.expiredPill}>
                          <Text maxFontSizeMultiplier={1.2} style={styles.expiredPillText}>Expired</Text>
                        </View>
                      )}
                    </View>
                    <Text maxFontSizeMultiplier={1.2} style={[styles.taggedCardText, item.isExpired && styles.taggedCardTextExpired]} numberOfLines={4}>
                      {item.confessionText}
                    </Text>
                    <View style={styles.taggedMetaRow}>
                      <View style={styles.taggedMetaItem}>
                        <Ionicons name="heart" size={12} color={COLORS.primary} />
                        <Text maxFontSizeMultiplier={1.2} style={styles.taggedMetaText}>Confess-to: You</Text>
                      </View>
                      <View style={styles.taggedMetaItem}>
                        <Ionicons name="chatbubble-outline" size={12} color={COLORS.textMuted} />
                        <Text maxFontSizeMultiplier={1.2} style={styles.taggedMetaCount}>{item.replyCount}</Text>
                      </View>
                    </View>
                  </TouchableOpacity>
                );
              }}
              ListEmptyComponent={
                <View style={styles.taggedEmptyState}>
                  <Text maxFontSizeMultiplier={1.2} style={styles.taggedEmptyText}>No tagged confessions yet</Text>
                </View>
              }
            />
          </View>
        </View>
      </Modal>
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
    gap: SPACING.xs,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.border,
  },
  headerTitle: {
    fontSize: moderateScale(15, 0.4),
    fontWeight: '700',
    color: COLORS.text,
  },
  headerButton: {
    padding: SPACING.xs,
  },
  headerRightGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.md,
  },
  listContent: {
    paddingBottom: moderateScale(80, 0.5),
  },
  feedReviewBadgeWrap: {
    marginHorizontal: SPACING.sm,
    marginTop: SPACING.xs,
    marginBottom: -SPACING.xxs,
    alignItems: 'flex-start',
  },
  loadingState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: SPACING.md,
  },
  loadingText: {
    fontSize: FONT_SIZE.lg,
    color: COLORS.textLight,
  },
  taggedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginHorizontal: SPACING.sm,
    marginTop: SPACING.sm,
    marginBottom: SPACING.sm,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.md,
    borderRadius: 14,
    backgroundColor: 'rgba(255,107,107,0.08)',
  },
  connectRequestsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginHorizontal: SPACING.sm,
    marginTop: 0,
    marginBottom: SPACING.sm,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.md,
    borderRadius: 14,
    backgroundColor: 'rgba(255,107,107,0.08)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,107,107,0.16)',
  },
  taggedRowLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    flex: 1,
  },
  taggedRowText: {
    fontSize: FONT_SIZE.md,
    fontWeight: '600',
    color: COLORS.text,
  },
  connectRequestsTextGroup: {
    flex: 1,
    minWidth: 0,
  },
  connectRequestsSubtitle: {
    marginTop: 2,
    fontSize: FONT_SIZE.xs,
    color: COLORS.textMuted,
  },
  badge: {
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    paddingHorizontal: SPACING.xs,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.primary,
  },
  badgeText: {
    fontSize: FONT_SIZE.sm,
    fontWeight: '700',
    color: COLORS.white,
  },
  // Trending card — editorial warm-gold left accent, crisp hairline, elevated
  // neutral shadow. No full colored outline, no colored shadow bleed. Reads
  // "featured / premium pick" without competing with the brand pink.
  trendingCard: {
    marginHorizontal: SPACING.sm,
    marginTop: SPACING.sm,
    marginBottom: SPACING.sm,
    borderRadius: 16,
    paddingHorizontal: SPACING.base,
    paddingTop: SPACING.md,
    paddingBottom: SPACING.md,
    paddingLeft: 16 - 3 + StyleSheet.hairlineWidth,
    backgroundColor: COLORS.background,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(17, 24, 39, 0.06)',
    borderLeftWidth: 3,
    borderLeftColor: '#B8860B',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 14,
    elevation: 4,
  },
  genderSymbol: {
    fontSize: FONT_SIZE.md,
    fontWeight: '700',
    marginLeft: SPACING.xxs,
    flexShrink: 0,
  },
  trendingBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: SPACING.xs,
    backgroundColor: 'rgba(184, 134, 11, 0.09)',
    paddingHorizontal: SPACING.sm,
    paddingVertical: SPACING.xxs,
    borderRadius: 8,
    marginBottom: SPACING.sm,
  },
  trendingBadgeText: {
    fontSize: FONT_SIZE.sm,
    fontWeight: '700',
    color: '#B8860B',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  trendingAuthorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    marginBottom: SPACING.sm,
  },
  trendingIdentityText: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    minWidth: 0,
  },
  trendingAvatar: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: 'rgba(255,107,107,0.12)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  trendingAvatarAnonymous: {
    backgroundColor: 'rgba(153,153,153,0.12)',
  },
  trendingAvatarImage: {
    width: 20,
    height: 20,
    borderRadius: 10,
  },
  trendingAuthorName: {
    fontSize: moderateScale(16, 0.4),
    fontWeight: '700',
    color: COLORS.textLight,
    flexShrink: 1,
    minWidth: 0,
  },
  // Public (open / blur_photo) name uses the premium readable text color.
  // Identity color (pink/blue) is reserved for the gender symbol only.
  trendingAuthorNamePublic: {
    color: COLORS.text,
  },
  trendingAuthorAge: {
    fontSize: moderateScale(16, 0.4),
    fontWeight: '700',
    color: COLORS.text,
    flexShrink: 0,
  },
  trendingTime: {
    fontSize: FONT_SIZE.caption,
    color: COLORS.textMuted,
    flexShrink: 0,
  },
  trendingText: {
    fontSize: moderateScale(15, 0.4),
    lineHeight: lineHeight(moderateScale(15, 0.4), 1.35),
    fontWeight: '400',
    color: COLORS.text,
    marginBottom: SPACING.sm,
  },
  heroTaggedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.xs,
    alignSelf: 'flex-start',
    marginBottom: SPACING.sm,
    paddingVertical: SPACING.xxs + 1,
    paddingHorizontal: SPACING.sm + 2,
    borderRadius: 8,
    backgroundColor: 'rgba(255,107,107,0.05)',
  },
  heroTaggedLabel: {
    fontSize: FONT_SIZE.sm,
    fontWeight: '500',
    color: COLORS.textMuted,
  },
  heroTaggedName: {
    maxWidth: moderateScale(180, 0.4),
    fontSize: FONT_SIZE.sm,
    fontWeight: '600',
    color: COLORS.primary,
    textDecorationLine: 'underline',
  },
  trendingMeta: {
    flexDirection: 'row',
    gap: SPACING.md,
  },
  trendingMetaItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.xs,
  },
  trendingMetaText: {
    fontSize: FONT_SIZE.caption,
    fontWeight: '500',
    color: COLORS.textMuted,
  },
  emptyState: {
    alignSelf: 'center',
    width: '100%',
    maxWidth: moderateScale(420, 0.4),
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: moderateScale(24, 0.5),
    paddingTop: moderateScale(40, 0.5),
    paddingBottom: moderateScale(24, 0.5),
  },
  emptyHeroIconRing: {
    width: moderateScale(72, 0.4),
    height: moderateScale(72, 0.4),
    borderRadius: moderateScale(36, 0.4),
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255, 107, 107, 0.10)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255, 107, 107, 0.28)',
    marginBottom: SPACING.base,
    shadowColor: COLORS.primary,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.18,
    shadowRadius: 14,
    elevation: 4,
  },
  emptyTitle: {
    fontSize: moderateScale(22, 0.4),
    fontWeight: '700',
    color: COLORS.text,
    marginBottom: SPACING.xs,
    textAlign: 'center',
    letterSpacing: 0.2,
  },
  emptySubtitle: {
    fontSize: moderateScale(14, 0.4),
    lineHeight: lineHeight(moderateScale(14, 0.4), 1.45),
    color: COLORS.textLight,
    textAlign: 'center',
    marginBottom: SPACING.lg,
  },
  emptyHeroSteps: {
    alignSelf: 'stretch',
    gap: SPACING.md,
    marginBottom: SPACING.xl,
  },
  emptyHeroStepRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: SPACING.md,
  },
  emptyHeroStepIconWrap: {
    width: moderateScale(30, 0.4),
    height: moderateScale(30, 0.4),
    borderRadius: moderateScale(15, 0.4),
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255, 107, 107, 0.10)',
    marginTop: 1,
  },
  emptyHeroStepText: {
    flex: 1,
    flexShrink: 1,
  },
  emptyHeroStepLabel: {
    fontSize: moderateScale(14, 0.4),
    fontWeight: '700',
    color: COLORS.text,
  },
  emptyHeroStepDesc: {
    marginTop: 2,
    fontSize: moderateScale(13, 0.4),
    lineHeight: lineHeight(moderateScale(13, 0.4), 1.4),
    color: COLORS.textLight,
  },
  emptyButton: {
    alignSelf: 'stretch',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACING.sm,
    borderRadius: 28,
    paddingHorizontal: SPACING.xl,
    paddingVertical: SPACING.md,
    backgroundColor: COLORS.primary,
    shadowColor: COLORS.primary,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.28,
    shadowRadius: 14,
    elevation: 4,
  },
  emptyButtonText: {
    fontSize: moderateScale(15, 0.4),
    fontWeight: '700',
    color: COLORS.white,
    letterSpacing: 0.3,
  },
  // Position wrapper for the draggable composer FAB. Holds only the
  // initial right anchor; bottom is set inline so we can pick up the
  // current safe-area inset, and left/top are taken over once the user
  // drags. The visual look (size, color, shadow) lives on `fab` below.
  fabPosition: {
    position: 'absolute',
    right: 16,
  },
  fab: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.primary,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.18,
    shadowRadius: 8,
    elevation: 6,
  },
  fabDisabled: {
    opacity: 0.65,
  },
  // My Confession card — brand-primary left accent + hairline + neutral shadow.
  // Single-edge cue signals authorship quietly without a loud full outline.
  myConfessionCard: {
    marginHorizontal: SPACING.sm,
    marginTop: SPACING.xs,
    marginBottom: SPACING.sm,
    borderRadius: 16,
    paddingHorizontal: SPACING.base,
    paddingTop: SPACING.md,
    paddingBottom: SPACING.md,
    paddingLeft: 16 - 3 + StyleSheet.hairlineWidth,
    backgroundColor: COLORS.background,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(17, 24, 39, 0.06)',
    borderLeftWidth: 3,
    borderLeftColor: COLORS.primary,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.06,
    shadowRadius: 12,
    elevation: 2,
  },
  myConfessionReviewBadge: {
    alignSelf: 'flex-start',
    marginBottom: SPACING.sm,
  },
  myConfessionAuthorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    marginBottom: SPACING.sm,
  },
  myConfessionIdentityText: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    minWidth: 0,
  },
  myConfessionAvatar: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: 'rgba(255,107,107,0.12)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  myConfessionAvatarAnonymous: {
    backgroundColor: 'rgba(153,153,153,0.12)',
  },
  myConfessionAvatarImage: {
    width: 20,
    height: 20,
    borderRadius: 10,
  },
  myConfessionAuthorName: {
    fontSize: moderateScale(16, 0.4),
    fontWeight: '700',
    color: COLORS.textLight,
    flexShrink: 1,
    minWidth: 0,
  },
  // Public (open / blur_photo) name uses the premium readable text color.
  // Identity color (pink/blue) is reserved for the gender symbol only.
  myConfessionAuthorNamePublic: {
    color: COLORS.text,
  },
  myConfessionAuthorAge: {
    fontSize: moderateScale(16, 0.4),
    fontWeight: '700',
    color: COLORS.text,
    flexShrink: 0,
  },
  myConfessionTime: {
    fontSize: FONT_SIZE.caption,
    color: COLORS.textMuted,
    flexShrink: 0,
  },
  myConfessionText: {
    fontSize: moderateScale(15, 0.4),
    lineHeight: lineHeight(moderateScale(15, 0.4), 1.35),
    fontWeight: '400',
    color: COLORS.text,
    marginBottom: SPACING.sm,
  },
  myConfessionMeta: {
    flexDirection: 'row',
    gap: SPACING.md,
  },
  myConfessionMetaItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.xs,
  },
  myConfessionMetaText: {
    fontSize: FONT_SIZE.caption,
    fontWeight: '500',
    color: COLORS.textMuted,
  },
  // Countdown notice
  countdownNotice: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACING.xs,
    marginHorizontal: SPACING.sm,
    marginBottom: SPACING.sm,
    paddingVertical: SPACING.sm,
    paddingHorizontal: SPACING.md,
    borderRadius: 10,
    backgroundColor: 'rgba(153,153,153,0.08)',
  },
  countdownText: {
    fontSize: FONT_SIZE.body2,
    color: COLORS.textMuted,
    fontWeight: '500',
  },
  toast: {
    position: 'absolute',
    top: 56,
    left: 24,
    right: 24,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACING.sm,
    paddingHorizontal: SPACING.base,
    paddingVertical: SPACING.md,
    borderRadius: 12,
    backgroundColor: COLORS.white,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.12,
    shadowRadius: 8,
    elevation: 4,
    zIndex: 20,
  },
  toastText: {
    fontSize: FONT_SIZE.md,
    fontWeight: '600',
    color: COLORS.text,
  },
  modalOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  taggedSheet: {
    flex: 1,
    marginTop: moderateScale(80, 0.5),
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    backgroundColor: COLORS.white,
  },
  taggedSheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: SPACING.base,
    paddingVertical: SPACING.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.border,
  },
  taggedSheetTitle: {
    fontSize: moderateScale(17, 0.4),
    fontWeight: '700',
    color: COLORS.text,
  },
  taggedSheetHint: {
    fontSize: FONT_SIZE.body2,
    color: COLORS.textLight,
    textAlign: 'center',
    paddingHorizontal: SPACING.xl,
    paddingTop: SPACING.sm,
    paddingBottom: SPACING.md,
  },
  taggedList: {
    paddingHorizontal: SPACING.md,
    paddingBottom: SPACING.xl,
  },
  taggedCard: {
    borderRadius: 16,
    padding: SPACING.md,
    marginBottom: SPACING.sm,
    backgroundColor: COLORS.backgroundDark,
  },
  taggedCardExpired: {
    opacity: 0.65,
  },
  taggedCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    marginBottom: SPACING.sm,
  },
  taggedAuthorIdentity: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.xs,
    flex: 1,
    minWidth: 0,
  },
  taggedAuthorIdentityText: {
    flexDirection: 'row',
    alignItems: 'center',
    flexShrink: 1,
    minWidth: 0,
  },
  taggedAuthorAvatar: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: 'rgba(255,107,107,0.12)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  taggedAuthorAvatarAnonymous: {
    backgroundColor: 'rgba(153,153,153,0.12)',
  },
  taggedAuthorAvatarImage: {
    width: 20,
    height: 20,
    borderRadius: 10,
  },
  taggedCardAuthor: {
    fontSize: FONT_SIZE.body2,
    fontWeight: '600',
    color: COLORS.textLight,
    flexShrink: 1,
    minWidth: 0,
  },
  taggedCardAuthorPublic: {
    color: COLORS.text,
  },
  taggedAuthorAge: {
    fontSize: FONT_SIZE.body2,
    fontWeight: '600',
    color: COLORS.text,
    flexShrink: 0,
  },
  taggedAuthorGenderSymbol: {
    fontSize: FONT_SIZE.body2,
    fontWeight: '700',
    marginLeft: SPACING.xxs,
    flexShrink: 0,
  },
  taggedBlurBadge: {
    padding: SPACING.xxs,
    backgroundColor: 'rgba(153,153,153,0.12)',
    borderRadius: 4,
    flexShrink: 0,
  },
  taggedCardTime: {
    fontSize: FONT_SIZE.caption,
    color: COLORS.textMuted,
    flexShrink: 0,
  },
  unseenDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: COLORS.primary,
  },
  expiredPill: {
    paddingHorizontal: SPACING.xs,
    paddingVertical: SPACING.xxs,
    borderRadius: 6,
    backgroundColor: 'rgba(153,153,153,0.15)',
  },
  expiredPillText: {
    fontSize: FONT_SIZE.xs,
    fontWeight: '700',
    color: COLORS.textMuted,
  },
  taggedCardText: {
    fontSize: moderateScale(15, 0.4),
    lineHeight: lineHeight(moderateScale(15, 0.4), 1.35),
    color: COLORS.text,
    marginBottom: SPACING.sm,
  },
  taggedCardTextExpired: {
    color: COLORS.textLight,
  },
  taggedMetaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  taggedMetaItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.xs,
  },
  taggedMetaText: {
    fontSize: FONT_SIZE.caption,
    fontWeight: '600',
    color: COLORS.primary,
  },
  taggedMetaCount: {
    fontSize: FONT_SIZE.caption,
    fontWeight: '600',
    color: COLORS.textMuted,
  },
  taggedEmptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: moderateScale(64, 0.5),
  },
  taggedEmptyText: {
    fontSize: moderateScale(15, 0.4),
    color: COLORS.textLight,
  },
});
