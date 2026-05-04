import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActionSheetIOS,
  ActivityIndicator,
  Alert,
  Animated,
  FlatList,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  TouchableWithoutFeedback,
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
import { asUserId } from '@/convex/id';
import { COLORS, FONT_SIZE, SPACING, lineHeight, moderateScale } from '@/lib/constants';
import { isContentClean } from '@/lib/contentFilter';
import { isProbablyEmoji } from '@/lib/utils';
import { getPhase1PrimaryPhoto } from '@/lib/photoUtils';
import { isDemoMode } from '@/hooks/useConvex';
import { useScreenTrace } from '@/lib/devTrace';
import { useAuthStore } from '@/stores/authStore';
import { useBlockStore } from '@/stores/blockStore';
import { useConfessionStore } from '@/stores/confessionStore';
import { useDemoStore } from '@/stores/demoStore';
import ConfessionCard from '@/components/confessions/ConfessionCard';
import { ConfessionMenuSheet } from '@/components/confessions/ConfessionMenuSheet';
import { HeaderAvatarButton } from '@/components/ui';

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
  targetUserId?: string;
  targetUserName?: string;
  topEmojis: { emoji: string; count: number }[];
  replyPreviews: Array<{ text: string; isAnonymous: boolean; type: string; createdAt: number }>;
  replyCount: number;
  reactionCount: number;
  createdAt: number;
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
};

// P0/P1 MENTION_RULE:
// Mention eligibility for user A = union(
//   users A liked/right-swiped,
//   users A is mutually matched with
// ). Each candidate is tagged with matchType so we can sort mutual_match
// above liked_only (done server-side) and optionally render a visual hint.
type LikedUser = {
  id: string;
  name: string;
  avatarUrl: string | null;
  age?: number;
  disambiguator: string;
  matchType?: 'mutual_match' | 'liked_only';
};

const DEMO_LIKED_USERS: LikedUser[] = [
  { id: 'demo_profile_2', name: 'Priya', avatarUrl: 'https://i.pravatar.cc/150?img=5', age: 24, disambiguator: 'Loves coffee', matchType: 'mutual_match' },
  { id: 'demo_profile_3', name: 'Rahul', avatarUrl: 'https://i.pravatar.cc/150?img=12', age: 27, disambiguator: 'Tech enthusiast', matchType: 'liked_only' },
  { id: 'demo_profile_4', name: 'Ananya', avatarUrl: 'https://i.pravatar.cc/150?img=9', age: 25, disambiguator: 'Mumbai', matchType: 'liked_only' },
  { id: 'demo_profile_5', name: 'Vikram', avatarUrl: 'https://i.pravatar.cc/150?img=11', age: 29, disambiguator: 'Photographer', matchType: 'liked_only' },
  { id: 'demo_profile_6', name: 'Priya', avatarUrl: 'https://i.pravatar.cc/150?img=16', age: 22, disambiguator: 'Yoga instructor', matchType: 'liked_only' },
];

function computeAge(dateOfBirth: string | undefined): number | undefined {
  if (!dateOfBirth) return undefined;
  const birthDate = new Date(dateOfBirth);
  if (Number.isNaN(birthDate.getTime())) return undefined;
  const today = new Date();
  let age = today.getFullYear() - birthDate.getFullYear();
  const monthDiff = today.getMonth() - birthDate.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
    age--;
  }
  return age > 0 && age < 120 ? age : undefined;
}

// P0-1: Blur radius for blur_photo identity mode (matches ConfessionCard)
const BLUR_PHOTO_RADIUS = 20;

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

export default function ConfessionsScreen() {
  useScreenTrace('CONFESSIONS');

  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { openTagged, openComposer } = useLocalSearchParams<{ openTagged?: string; openComposer?: string }>();
  const userId = useAuthStore((s) => s.userId);
  const currentUserId = isDemoMode ? (userId || 'demo_user_1') : userId;

  const demoConfessions = useConfessionStore((s) => s.confessions);
  const demoUserReactions = useConfessionStore((s) => s.userReactions);
  const demoToggleReaction = useConfessionStore((s) => s.toggleReaction);
  const demoAddConfession = useConfessionStore((s) => s.addConfession);
  const demoDeleteConfession = useConfessionStore((s) => s.deleteConfession);
  const demoReportConfession = useConfessionStore((s) => s.reportConfession);
  const demoCanPostConfession = useConfessionStore((s) => s.canPostConfession);
  const demoRecordConfessionTimestamp = useConfessionStore((s) => s.recordConfessionTimestamp);
  const getTimeUntilNextConfession = useConfessionStore((s) => s.getTimeUntilNextConfession);
  const getMyLatestConfession = useConfessionStore((s) => s.getMyLatestConfession);
  const seenTaggedConfessionIds = useConfessionStore((s) => s.seenTaggedConfessionIds);
  const markTaggedConfessionSeen = useConfessionStore((s) => s.markTaggedConfessionSeen);
  const markAllTaggedConfessionsSeen = useConfessionStore((s) => s.markAllTaggedConfessionsSeen);

  const blockedUserIds = useBlockStore((s) => s.blockedUserIds);
  const blockUserLocal = useBlockStore((s) => s.blockUser);

  const demoCurrentUserId = useDemoStore((s) => s.currentDemoUserId);
  const demoProfiles = useDemoStore((s) => s.demoProfiles);
  const demoCurrentUser = demoCurrentUserId ? demoProfiles[demoCurrentUserId] : null;

  const convexCurrentUser = useQuery(
    api.users.getCurrentUser,
    !isDemoMode && currentUserId ? { userId: asUserId(currentUserId) ?? currentUserId } : 'skip'
  );
  const convexCurrentUserId = !isDemoMode ? (convexCurrentUser?._id ?? asUserId(currentUserId ?? '')) : undefined;

  const liveConfessions = useQuery(
    api.confessions.listConfessions,
    !isDemoMode ? { sortBy: 'latest', viewerId: currentUserId ?? undefined } : 'skip'
  );
  const liveTrending = useQuery(
    api.confessions.getTrendingConfessions,
    !isDemoMode ? { viewerId: currentUserId ?? undefined } : 'skip'
  );
  const liveTaggedConfessions = useQuery(
    api.confessions.listTaggedConfessionsForUser,
    !isDemoMode && currentUserId ? { userId: currentUserId } : 'skip'
  );
  const liveTaggedCount = useQuery(
    api.confessions.getTaggedConfessionBadgeCount,
    !isDemoMode && currentUserId ? { userId: currentUserId } : 'skip'
  );
  const likedUsersQuery = useQuery(
    api.likes.getLikedUsers,
    !isDemoMode && convexCurrentUserId ? { userId: convexCurrentUserId } : 'skip'
  );

  const createConfessionMutation = useMutation(api.confessions.createConfession);
  const toggleReactionMutation = useMutation(api.confessions.toggleReaction);
  const reportConfessionMutation = useMutation(api.confessions.reportConfession);
  const deleteConfessionMutation = useMutation(api.confessions.deleteConfession);
  const markTaggedSeenMutation = useMutation(api.confessions.markTaggedConfessionsSeen);
  const blockUserMutation = useMutation(api.users.blockUser);

  const [hiddenConfessionIds, setHiddenConfessionIds] = useState<string[]>([]);
  const [showTaggedSection, setShowTaggedSection] = useState(false);
  const [showComposer, setShowComposer] = useState(false);
  const [composerText, setComposerText] = useState('');
  const [composerAnonymous, setComposerAnonymous] = useState(true);
  const [composerSubmitting, setComposerSubmitting] = useState(false);
  const [showComposerEmoji, setShowComposerEmoji] = useState(false);
  const [showReactionEmoji, setShowReactionEmoji] = useState(false);
  const [emojiTargetConfessionId, setEmojiTargetConfessionId] = useState<string | null>(null);
  const [tagInput, setTagInput] = useState('');
  const [taggedUser, setTaggedUser] = useState<LikedUser | null>(null);
  const [showDuplicatePicker, setShowDuplicatePicker] = useState(false);
  const [duplicateCandidates, setDuplicateCandidates] = useState<LikedUser[]>([]);
  const [liveUserReactions, setLiveUserReactions] = useState<Record<string, string | null>>({});
  const [showToast, setShowToast] = useState(false);
  const [toastMessage, setToastMessage] = useState('');
  const [showMenuSheet, setShowMenuSheet] = useState(false);
  const [menuTargetConfession, setMenuTargetConfession] = useState<{ id: string; authorId: string } | null>(null);
  const [countdownMs, setCountdownMs] = useState(0);
  const toastOpacity = useRef(new Animated.Value(0)).current;
  const composerInputRef = useRef<TextInput>(null);
  const pendingBlockAuthorsRef = useRef<Set<string>>(new Set());

  const effectiveViewerId = isDemoMode ? currentUserId : convexCurrentUser?._id;

  const likedUsers = useMemo<LikedUser[]>(
    () => (isDemoMode ? DEMO_LIKED_USERS : (likedUsersQuery ?? [])),
    [isDemoMode, likedUsersQuery]
  );

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

  const getAuthorInfo = useCallback(() => {
    if (isDemoMode && demoCurrentUser) {
      return {
        authorName: demoCurrentUser.name,
        authorPhotoUrl: demoCurrentUser.photos?.[0]?.url,
        authorAge: (demoCurrentUser as any).age,
        authorGender: (demoCurrentUser as any).gender,
      };
    }

    if (!isDemoMode && convexCurrentUser) {
      return {
        authorName: (convexCurrentUser as any).name,
        authorPhotoUrl: getPhase1PrimaryPhoto(convexCurrentUser) ?? undefined,
        authorAge: computeAge((convexCurrentUser as any).dateOfBirth),
        authorGender: (convexCurrentUser as any).gender,
      };
    }

    return {};
  }, [convexCurrentUser, demoCurrentUser]);

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
          targetUserId: confession.taggedUserId,
          topEmojis: confession.topEmojis ?? [],
          replyPreviews: confession.replyPreviews ?? [],
          replyCount: confession.replyCount ?? 0,
          reactionCount: confession.reactionCount ?? 0,
          createdAt: confession.createdAt,
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
        targetUserId: confession.targetUserId,
        targetUserName: confession.targetUserName,
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
      }));
    }

    return demoConfessions
      .filter((confession: any) => confession.targetUserId === currentUserId)
      .sort((a: any, b: any) => b.createdAt - a.createdAt)
      .map((confession: any) => {
        const expiresAt = confession.expiresAt ?? confession.createdAt + 24 * 60 * 60 * 1000;
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
        };
      });
  }, [currentUserId, demoConfessions, liveTaggedConfessions, seenTaggedConfessionIds]);

  const taggedBadgeCount = useMemo(() => {
    if (!isDemoMode) return liveTaggedCount ?? 0;
    return taggedConfessions.filter((item) => !item.seen && !item.isExpired).length;
  }, [isDemoMode, liveTaggedCount, taggedConfessions]);

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

  const tagSuggestions = useMemo(() => {
    // P0/P1 MENTION_RULE + P1 Confess autocomplete:
    // - `likedUsers` is the single source of truth: union(liked, mutual_match),
    //   de-duped, sorted mutual_match -> liked_only -> alphabetical by the server.
    // - Gate on 3+ typed chars, trim + lowercase, prefix match (startsWith).
    // - DO NOT filter by candidate name length (legacy bug hid short names
    //   like "Sruti").
    // - DO NOT re-sort — preserve server-provided matchType order.
    if (!tagInput) {
      if (__DEV__) console.log('[CONFESS_SEARCH][input] empty', { tagInput, taggedUserId: taggedUser?.id });
      return [];
    }
    const normalized = tagInput.toLowerCase().trim();
    if (normalized.length < 3 || taggedUser) {
      if (__DEV__) {
        console.log('[CONFESS_SEARCH][dropdown] hidden', {
          reason: taggedUser ? 'already_tagged' : 'below_min_length',
          tagInput,
          normalized,
          normalizedLength: normalized.length,
        });
      }
      return [];
    }
    const sourceCount = likedUsers.length;
    const mutualCount = likedUsers.filter((u) => u.matchType === 'mutual_match').length;
    const likedOnlyCount = likedUsers.filter((u) => u.matchType === 'liked_only').length;
    const matched = likedUsers
      .filter((user) => user.name.trim().toLowerCase().startsWith(normalized))
      .slice(0, 5);
    if (__DEV__) {
      console.log('[MENTION_RULE][source]', { sourceCount, mutualCount, likedOnlyCount });
      console.log('[MENTION_RULE][search]', {
        query: tagInput,
        normalized,
        matchCount: matched.length,
        matches: matched.map((u) => ({ id: u.id, name: u.name, matchType: u.matchType })),
      });
      console.log('[CONFESS_SEARCH][source]', { sourceCount });
      console.log('[CONFESS_SEARCH][filtered]', {
        tagInput,
        normalized,
        matchCount: matched.length,
        matchedNames: matched.map((u) => u.name),
      });
      console.log('[CONFESS_SEARCH][dropdown]', {
        willShow: matched.length > 0 && !taggedUser,
        shownCount: matched.length,
      });
    }
    return matched;
  }, [likedUsers, tagInput, taggedUser]);

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
    (!!currentUserId && (liveTaggedConfessions === undefined || liveTaggedCount === undefined))
  );

  const handleOpenComposer = useCallback(() => {
    // Check if user can post (1 confession per 24h limit)
    if (!canPostNow && countdownMs > 0) {
      showToastMessage(`You've already shared today. Try again in ${formatCountdown(countdownMs)}`);
      return;
    }

    setComposerText('');
    setComposerAnonymous(true);
    setTagInput('');
    setTaggedUser(null);
    setShowDuplicatePicker(false);
    setDuplicateCandidates([]);
    safePush(router, '/(main)/compose-confession' as any, 'confessions->compose');
  }, [canPostNow, countdownMs, formatCountdown, router, showToastMessage]);

  const handleCloseComposer = useCallback(() => {
    Keyboard.dismiss();
    setShowComposer(false);
  }, []);

  const handleTagInputChange = useCallback((text: string) => {
    setTagInput(text);
    setTaggedUser(null);

    const normalized = text.toLowerCase().trim();
    if (!normalized) return;

    const exactMatches = likedUsers.filter((user) => user.name.toLowerCase() === normalized);
    if (exactMatches.length === 1 && exactMatches[0].name.length <= 7) {
      setTaggedUser(exactMatches[0]);
      setTagInput(exactMatches[0].name);
      return;
    }

    if (exactMatches.length > 1) {
      setDuplicateCandidates(exactMatches);
      setShowDuplicatePicker(true);
    }
  }, [likedUsers]);

  const handleSubmitComposer = useCallback(async () => {
    if (!currentUserId || composerSubmitting) return;

    const trimmed = composerText.trim();
    if (trimmed.length < 10) {
      Alert.alert('Too Short', 'Confessions must be at least 10 characters.');
      return;
    }

    if (tagInput.trim() && !taggedUser) {
      Alert.alert('Select a Person', 'Pick a valid person from the suggestions, or clear the tag field.');
      return;
    }

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

    if (isDemoMode && !demoCanPostConfession()) {
      Alert.alert('Limit Reached', "You've reached today's confession limit. Try again later.");
      return;
    }

    const authorInfo = !composerAnonymous ? getAuthorInfo() : {};
    if (!composerAnonymous && !authorInfo.authorName) {
      Alert.alert('Profile Not Ready', 'Your profile is still loading. Please try again in a moment, or post anonymously.');
      return;
    }

    setComposerSubmitting(true);

    try {
      if (isDemoMode) {
        const createdAt = Date.now();
        demoAddConfession({
          id: `conf_new_${createdAt}`,
          userId: currentUserId,
          text: trimmed,
          isAnonymous: composerAnonymous,
          mood: 'emotional',
          topEmojis: [],
          replyPreviews: [],
          visibility: 'global',
          replyCount: 0,
          reactionCount: 0,
          createdAt,
          expiresAt: createdAt + 24 * 60 * 60 * 1000,
          revealPolicy: 'never',
          targetUserId: taggedUser?.id,
          targetUserName: taggedUser?.name,
          ...(authorInfo.authorName ? { authorName: authorInfo.authorName } : {}),
          ...(authorInfo.authorPhotoUrl ? { authorPhotoUrl: authorInfo.authorPhotoUrl } : {}),
          ...(authorInfo.authorAge ? { authorAge: authorInfo.authorAge } : {}),
          ...(authorInfo.authorGender ? { authorGender: authorInfo.authorGender } : {}),
        } as any);
        demoRecordConfessionTimestamp();
      } else {
        await createConfessionMutation({
          userId: currentUserId,
          text: trimmed,
          isAnonymous: composerAnonymous,
          mood: 'emotional',
          visibility: 'global',
          taggedUserId: taggedUser?.id as any,
          ...(authorInfo.authorName ? { authorName: authorInfo.authorName } : {}),
          ...(authorInfo.authorPhotoUrl ? { authorPhotoUrl: authorInfo.authorPhotoUrl } : {}),
          ...(authorInfo.authorAge ? { authorAge: authorInfo.authorAge } : {}),
          ...(authorInfo.authorGender ? { authorGender: authorInfo.authorGender } : {}),
        });
      }

      handleCloseComposer();
      setComposerText('');
      setTagInput('');
      setTaggedUser(null);
      showToastMessage('Confession posted');
    } catch (error: any) {
      Alert.alert('Error', error?.message || 'Failed to post confession');
    } finally {
      setComposerSubmitting(false);
    }
  }, [
    composerAnonymous,
    composerSubmitting,
    composerText,
    currentUserId,
    createConfessionMutation,
    demoAddConfession,
    demoCanPostConfession,
    demoRecordConfessionTimestamp,
    getAuthorInfo,
    handleCloseComposer,
    showToastMessage,
    tagInput,
    taggedUser,
  ]);

  const handleOpenTaggedSection = useCallback(() => {
    setShowTaggedSection(true);
    if (!currentUserId) return;

    if (isDemoMode) {
      const unseenIds = taggedConfessions.filter((item) => !item.seen && !item.isExpired).map((item) => item.confessionId);
      if (unseenIds.length > 0) {
        markAllTaggedConfessionsSeen(unseenIds);
      }
      return;
    }

    markTaggedSeenMutation({ userId: currentUserId }).catch(() => {
      // Keep the feed usable even if badge clearing fails.
    });
  }, [currentUserId, isDemoMode, markAllTaggedConfessionsSeen, markTaggedSeenMutation, taggedConfessions]);

  const handleOpenThread = useCallback((confessionId?: string | null) => {
    if (!confessionId) {
      if (__DEV__) {
        console.warn('[CONFESS_CARD_PRESS_BLOCKED_MISSING_ID]', { source: 'handleOpenThread' });
      }
      return;
    }
    if (__DEV__) {
      console.log('[CONFESS_THREAD_NAVIGATE]', { source: 'confessions', hasId: true });
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
  }, [currentUserId, demoToggleReaction, isDemoMode, toggleReactionMutation]);

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
              userId: currentUserId,
            });
          } catch {
            setHiddenConfessionIds((current) => current.filter((id) => id !== confessionId));
            Alert.alert('Unable to delete right now');
          }
        },
      },
    ]);
  }, [currentUserId, deleteConfessionMutation, demoDeleteConfession, effectiveViewerId, isDemoMode]);

  const handleSubmitReport = useCallback(async (
    confessionId: string,
    reason: 'spam' | 'harassment' | 'hate' | 'sexual' | 'other'
  ) => {
    if (isDemoMode) {
      demoReportConfession(confessionId);
      setHiddenConfessionIds((current) => current.includes(confessionId) ? current : [...current, confessionId]);
      return;
    }

    if (!currentUserId) return;

    try {
      await reportConfessionMutation({
        confessionId: confessionId as any,
        reporterId: currentUserId,
        reason,
      });
      setHiddenConfessionIds((current) => current.includes(confessionId) ? current : [...current, confessionId]);
    } catch {
      Alert.alert('Unable to report right now');
    }
  }, [currentUserId, demoReportConfession, isDemoMode, reportConfessionMutation]);

  const showReportReasonPicker = useCallback((confessionId: string) => {
    const reasons = [
      { key: 'spam', label: 'Spam' },
      { key: 'harassment', label: 'Harassment' },
      { key: 'hate', label: 'Hate Speech' },
      { key: 'sexual', label: 'Sexual/Inappropriate' },
      { key: 'other', label: 'Other' },
    ] as const;

    const submit = (reason: typeof reasons[number]['key']) => {
      void handleSubmitReport(confessionId, reason);
    };

    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          title: 'Why are you reporting this?',
          options: ['Cancel', ...reasons.map((reason) => reason.label)],
          cancelButtonIndex: 0,
        },
        (buttonIndex) => {
          if (buttonIndex > 0) {
            submit(reasons[buttonIndex - 1].key);
          }
        }
      );
      return;
    }

    Alert.alert('Report Confession', 'Select a reason:', [
      { text: 'Cancel', style: 'cancel' },
      ...reasons.map((reason) => ({
        text: reason.label,
        onPress: () => submit(reason.key),
      })),
    ]);
  }, [handleSubmitReport]);

  const handleBlockAuthor = useCallback(async (authorId: string) => {
    if (!currentUserId || !authorId) return;

    if (isDemoMode) {
      blockUserLocal(authorId);
      return;
    }

    if (pendingBlockAuthorsRef.current.has(authorId)) return;
    pendingBlockAuthorsRef.current.add(authorId);

    try {
      await blockUserMutation({
        authUserId: currentUserId,
        blockedUserId: authorId as any,
      });
      blockUserLocal(authorId);
    } catch {
      Alert.alert('Unable to block user right now');
    } finally {
      pendingBlockAuthorsRef.current.delete(authorId);
    }
  }, [blockUserLocal, blockUserMutation, currentUserId, isDemoMode]);

  // Open the premium menu sheet instead of alert
  const handleOpenMenuSheet = useCallback((confessionId: string, authorId: string) => {
    const isOwner = authorId === effectiveViewerId;
    if (__DEV__) {
      console.log('[CONFESS_LONG_PRESS] menu opening', {
        confessionId: confessionId.slice(-6),
        isOwner,
        menuType: isOwner ? 'owner (Edit/Delete/Cancel)' : 'non-owner (Report/Cancel)',
      });
    }
    setMenuTargetConfession({ id: confessionId, authorId });
    setShowMenuSheet(true);
  }, [effectiveViewerId]);

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
    showReportReasonPicker(menuTargetConfession.id);
  }, [menuTargetConfession, showReportReasonPicker]);

  const handleMenuEdit = useCallback(() => {
    console.log('[EDIT_HANDLER] handleMenuEdit called, menuTargetConfession:', menuTargetConfession);
    if (!menuTargetConfession) {
      console.log('[EDIT_HANDLER] ABORT: menuTargetConfession is null');
      return;
    }
    // Navigate to compose-confession in edit mode
    // The compose-confession screen handles all edit logic including:
    // - fetching existing confession data
    // - prefilling form fields
    // - update mutation
    console.log('[EDIT_NAVIGATE] Opening compose-confession for edit:', menuTargetConfession.id);
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
        return (
        <TouchableOpacity
          style={styles.trendingCard}
          activeOpacity={0.88}
          onPress={() => {
            if (__DEV__) console.log('[CONFESS_CARD_PRESS]', { screen: 'confessions', source: 'trending', hasId: !!trendingHero.id });
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
                blurRadius={BLUR_PHOTO_RADIUS}
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
        return (
        <TouchableOpacity
          style={styles.myConfessionCard}
          activeOpacity={0.88}
          onPress={() => {
            const confessionId = (myLatestConfession as any).id || (myLatestConfession as any)._id;
            if (__DEV__) console.log('[CONFESS_CARD_PRESS]', { screen: 'confessions', source: 'my-confession', hasId: !!confessionId });
            handleOpenThread(confessionId);
          }}
          onLongPress={() => handleOpenMenuSheet(
            (myLatestConfession as any).id || (myLatestConfession as any)._id,
            (myLatestConfession as any).userId
          )}
          delayLongPress={300}
        >
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
                blurRadius={BLUR_PHOTO_RADIUS}
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
    </View>
  ), [canPostNow, countdownMs, formatCountdown, handleOpenTaggedSection, handleOpenThread, myLatestConfession, taggedBadgeCount, taggedConfessions.length, trendingHero]);

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

      <Text maxFontSizeMultiplier={1.2} style={styles.topHint}>Choose how you want to be seen</Text>

      <FlatList
        data={filteredConfessions}
        keyExtractor={(item) => item.id}
        ListHeaderComponent={renderHeader}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        renderItem={({ item }) => {
          const userEmoji = isDemoMode
            ? (demoUserReactions[item.id] && isProbablyEmoji(demoUserReactions[item.id]!) ? demoUserReactions[item.id]! : null)
            : (liveUserReactions[item.id] ?? null);
          const isTaggedForMe = item.targetUserId != null && item.targetUserId === effectiveViewerId;

          return (
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
              taggedUserId={item.targetUserId}
              taggedUserName={item.targetUserName}
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
            />
          );
        }}
        ListEmptyComponent={
          // Only show empty state if NO confessions exist at all (not just filtered list)
          confessions.length === 0 ? (
            <View style={styles.emptyState}>
              <Text maxFontSizeMultiplier={1.2} style={styles.emptyEmoji}>💬</Text>
              <Text maxFontSizeMultiplier={1.2} style={styles.emptyTitle}>No confessions yet</Text>
              <Text maxFontSizeMultiplier={1.2} style={styles.emptySubtitle}>Be the first to share something</Text>
              <TouchableOpacity style={styles.emptyButton} onPress={handleOpenComposer}>
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

      <TouchableOpacity
        style={[
          styles.fab,
          { bottom: Math.max(insets.bottom, 16) + 8 },
          !canPostNow && styles.fabDisabled,
        ]}
        onPress={handleOpenComposer}
        activeOpacity={canPostNow ? 0.8 : 0.9}
      >
        <Ionicons name="add" size={24} color={COLORS.white} />
      </TouchableOpacity>

      {/* Premium menu sheet for confession actions */}
      <ConfessionMenuSheet
        visible={showMenuSheet}
        isOwner={menuTargetConfession?.authorId === effectiveViewerId}
        onClose={handleCloseMenuSheet}
        onEdit={handleMenuEdit}
        onDelete={handleMenuDelete}
        onReport={handleMenuReport}
      />

      <EmojiPicker
        open={showReactionEmoji}
        onClose={() => {
          setShowReactionEmoji(false);
          setEmojiTargetConfessionId(null);
        }}
        onEmojiSelected={handleReactionEmojiSelected}
      />

      <Modal visible={showComposer} animationType="slide" transparent onRequestClose={handleCloseComposer}>
        <TouchableWithoutFeedback onPress={handleCloseComposer}>
          <View style={styles.modalOverlay}>
            <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
              <KeyboardAvoidingView
                behavior={Platform.OS === 'ios' ? 'padding' : undefined}
                style={styles.sheet}
              >
                <View style={styles.sheetHandle} />

                <View style={styles.sheetHeader}>
                  <TouchableOpacity onPress={handleCloseComposer}>
                    <Ionicons name="close" size={24} color={COLORS.text} />
                  </TouchableOpacity>
                  <Text maxFontSizeMultiplier={1.2} style={styles.sheetTitle}>New Confession</Text>
                  <TouchableOpacity
                    onPress={handleSubmitComposer}
                    disabled={composerSubmitting || composerText.trim().length < 10}
                    style={[
                      styles.postButton,
                      (composerSubmitting || composerText.trim().length < 10) && styles.postButtonDisabled,
                    ]}
                  >
                    <Text
                      style={[
                        styles.postButtonText,
                        (composerSubmitting || composerText.trim().length < 10) && styles.postButtonTextDisabled,
                      ]}
                    >
                      {composerSubmitting ? 'Posting...' : 'Post'}
                    </Text>
                  </TouchableOpacity>
                </View>

                <View style={styles.sheetBanner}>
                  <Ionicons name="shield-checkmark" size={14} color={COLORS.primary} />
                  <Text maxFontSizeMultiplier={1.2} style={styles.sheetBannerText}>Don&apos;t include phone numbers or personal details.</Text>
                </View>

                <TextInput
                  ref={composerInputRef}
                  style={styles.composerInput}
                  placeholder="What's on your mind? Share your confession..."
                  placeholderTextColor={COLORS.textMuted}
                  multiline
                  maxLength={500}
                  textAlignVertical="top"
                  value={composerText}
                  onChangeText={setComposerText}
                />

                <View style={styles.composerToolbar}>
                  <TouchableOpacity onPress={() => setShowComposerEmoji(true)}>
                    <Text maxFontSizeMultiplier={1.2} style={styles.toolbarEmoji}>🙂</Text>
                  </TouchableOpacity>
                  <View style={{ flex: 1 }} />
                  <Text maxFontSizeMultiplier={1.2} style={styles.charCount}>{composerText.length}/500</Text>
                </View>

                <View style={styles.tagSection}>
                  <View style={styles.tagHeader}>
                    <Ionicons name="heart-outline" size={18} color={COLORS.primary} />
                    <Text maxFontSizeMultiplier={1.2} style={styles.tagTitle}>Mention username (optional)</Text>
                  </View>

                  {taggedUser ? (
                    <View style={styles.selectedTagRow}>
                      {taggedUser.avatarUrl ? (
                        <Image source={{ uri: taggedUser.avatarUrl }} style={styles.tagAvatar} contentFit="cover" />
                      ) : (
                        <View style={styles.tagAvatarFallback}>
                          <Ionicons name="person" size={16} color={COLORS.white} />
                        </View>
                      )}
                      <View style={{ flex: 1 }}>
                        <Text maxFontSizeMultiplier={1.2} style={styles.tagName}>
                          {taggedUser.name}{taggedUser.age ? `, ${taggedUser.age}` : ''}
                        </Text>
                        <Text maxFontSizeMultiplier={1.2} style={styles.tagHint}>{taggedUser.disambiguator}</Text>
                      </View>
                      <TouchableOpacity onPress={() => {
                        setTaggedUser(null);
                        setTagInput('');
                      }}>
                        <Ionicons name="close-circle" size={20} color={COLORS.textMuted} />
                      </TouchableOpacity>
                    </View>
                  ) : (
                    <>
                      <TextInput
                        style={styles.tagInput}
                        placeholder="Type a name from people you've liked..."
                        placeholderTextColor={COLORS.textMuted}
                        value={tagInput}
                        onChangeText={handleTagInputChange}
                      />
                      <Text maxFontSizeMultiplier={1.2} style={styles.tagHint}>
                        {likedUsers.length > 0 ? 'You can only tag people you liked.' : 'Like someone first to confess to them.'}
                      </Text>
                    </>
                  )}

                  {tagSuggestions.length > 0 && !taggedUser && (
                    <View style={styles.suggestionList}>
                      {tagSuggestions.map((user) => (
                        <TouchableOpacity
                          key={user.id}
                          style={styles.suggestionRow}
                          onPress={() => {
                            if (__DEV__) {
                              console.log('[MENTION_RULE][selected]', {
                                id: user.id,
                                name: user.name,
                                matchType: user.matchType,
                              });
                            }
                            setTaggedUser(user);
                            setTagInput(user.name);
                          }}
                        >
                          <View style={styles.suggestionAvatar}>
                            <Ionicons name="person" size={14} color={COLORS.white} />
                          </View>
                          <View style={{ flex: 1 }}>
                            <Text maxFontSizeMultiplier={1.2} style={styles.suggestionName}>{user.name}</Text>
                            <Text maxFontSizeMultiplier={1.2} style={styles.suggestionHint}>{user.disambiguator}</Text>
                          </View>
                        </TouchableOpacity>
                      ))}
                    </View>
                  )}
                </View>

                <View style={styles.visibilityRow}>
                  <View style={styles.visibilityInfo}>
                    <Ionicons
                      name={composerAnonymous ? 'eye-off' : 'person'}
                      size={20}
                      color={composerAnonymous ? COLORS.textMuted : COLORS.primary}
                    />
                    <View>
                      <Text maxFontSizeMultiplier={1.2} style={styles.visibilityTitle}>{composerAnonymous ? 'Anonymous' : 'Open to all'}</Text>
                      <Text maxFontSizeMultiplier={1.2} style={styles.visibilitySubtitle}>
                        {composerAnonymous ? 'Your identity stays hidden' : 'Your profile will be visible'}
                      </Text>
                    </View>
                  </View>
                  <Switch
                    value={!composerAnonymous}
                    onValueChange={(value) => setComposerAnonymous(!value)}
                    trackColor={{ false: COLORS.border, true: COLORS.primaryLight }}
                    thumbColor={!composerAnonymous ? COLORS.primary : '#f4f3f4'}
                  />
                </View>

                <View style={{ height: Math.max(insets.bottom, 16) }} />
              </KeyboardAvoidingView>
            </TouchableWithoutFeedback>
          </View>
        </TouchableWithoutFeedback>
      </Modal>

      <EmojiPicker
        open={showComposerEmoji}
        onClose={() => setShowComposerEmoji(false)}
        onEmojiSelected={(emoji: any) => setComposerText((current) => current + emoji.emoji)}
      />

      <Modal visible={showDuplicatePicker} transparent animationType="fade" onRequestClose={() => setShowDuplicatePicker(false)}>
        <TouchableWithoutFeedback onPress={() => setShowDuplicatePicker(false)}>
          <View style={styles.duplicateOverlay}>
            <TouchableWithoutFeedback>
              <View style={styles.duplicateSheet}>
                <Text maxFontSizeMultiplier={1.2} style={styles.duplicateTitle}>Multiple people named &quot;{tagInput}&quot;</Text>
                <Text maxFontSizeMultiplier={1.2} style={styles.duplicateSubtitle}>Choose who you want to confess to.</Text>
                {duplicateCandidates.map((user) => (
                  <TouchableOpacity
                    key={user.id}
                    style={styles.duplicateRow}
                    onPress={() => {
                      if (__DEV__) {
                        console.log('[MENTION_RULE][selected]', {
                          id: user.id,
                          name: user.name,
                          matchType: user.matchType,
                          via: 'duplicate_picker',
                        });
                      }
                      setTaggedUser(user);
                      setTagInput(user.name);
                      setShowDuplicatePicker(false);
                    }}
                  >
                    {user.avatarUrl ? (
                      <Image source={{ uri: user.avatarUrl }} style={styles.duplicateAvatar} contentFit="cover" />
                    ) : (
                      <View style={styles.duplicateAvatarFallback}>
                        <Ionicons name="person" size={18} color={COLORS.white} />
                      </View>
                    )}
                    <View style={{ flex: 1 }}>
                      <Text maxFontSizeMultiplier={1.2} style={styles.duplicateName}>
                        {user.name}{user.age ? `, ${user.age}` : ''}
                      </Text>
                      <Text maxFontSizeMultiplier={1.2} style={styles.duplicateHint}>{user.disambiguator}</Text>
                    </View>
                    <Ionicons name="chevron-forward" size={18} color={COLORS.textMuted} />
                  </TouchableOpacity>
                ))}
              </View>
            </TouchableWithoutFeedback>
          </View>
        </TouchableWithoutFeedback>
      </Modal>

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
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={[styles.taggedCard, item.isExpired && styles.taggedCardExpired]}
                  activeOpacity={item.isExpired ? 1 : 0.82}
                  onPress={() => handleSelectTaggedConfession(item)}
                >
                  <View style={styles.taggedCardHeader}>
                    <Text maxFontSizeMultiplier={1.2} style={styles.taggedCardAuthor}>Anonymous</Text>
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
              )}
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
  topHint: {
    fontSize: FONT_SIZE.caption,
    color: COLORS.textLight,
    textAlign: 'center',
    paddingHorizontal: SPACING.base,
    paddingTop: SPACING.sm,
    paddingBottom: SPACING.xs,
  },
  listContent: {
    paddingBottom: moderateScale(80, 0.5),
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
  taggedRowLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
  },
  taggedRowText: {
    fontSize: FONT_SIZE.md,
    fontWeight: '600',
    color: COLORS.text,
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
    fontSize: FONT_SIZE.body2,
    fontWeight: '600',
    color: COLORS.textLight,
    flexShrink: 1,
    minWidth: 0,
  },
  trendingAuthorNamePublic: {
    color: COLORS.primary,
  },
  trendingAuthorAge: {
    fontSize: FONT_SIZE.body2,
    fontWeight: '600',
    color: COLORS.primary,
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
    fontWeight: '500',
    color: COLORS.text,
    marginBottom: SPACING.sm,
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
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: moderateScale(32, 0.5),
    paddingTop: moderateScale(64, 0.5),
  },
  emptyEmoji: {
    fontSize: moderateScale(56, 0.4),
    marginBottom: SPACING.base,
  },
  emptyTitle: {
    fontSize: moderateScale(22, 0.4),
    fontWeight: '700',
    color: COLORS.text,
    marginBottom: SPACING.sm,
    textAlign: 'center',
  },
  emptySubtitle: {
    fontSize: moderateScale(15, 0.4),
    lineHeight: lineHeight(moderateScale(15, 0.4), 1.35),
    color: COLORS.textLight,
    textAlign: 'center',
    marginBottom: SPACING.xl,
  },
  emptyButton: {
    borderRadius: 24,
    paddingHorizontal: SPACING.xl,
    paddingVertical: SPACING.md,
    backgroundColor: COLORS.primary,
  },
  emptyButtonText: {
    fontSize: moderateScale(15, 0.4),
    fontWeight: '600',
    color: COLORS.white,
  },
  fab: {
    position: 'absolute',
    right: 16,
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
    fontSize: FONT_SIZE.body2,
    fontWeight: '600',
    color: COLORS.textLight,
    flexShrink: 1,
    minWidth: 0,
  },
  myConfessionAuthorNamePublic: {
    color: COLORS.primary,
  },
  myConfessionAuthorAge: {
    fontSize: FONT_SIZE.body2,
    fontWeight: '600',
    color: COLORS.primary,
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
    fontWeight: '500',
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
  sheet: {
    backgroundColor: COLORS.white,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '88%',
  },
  sheetHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    alignSelf: 'center',
    marginTop: SPACING.sm,
    marginBottom: SPACING.xs,
    backgroundColor: COLORS.border,
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: SPACING.base,
    paddingVertical: SPACING.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.border,
  },
  sheetTitle: {
    fontSize: moderateScale(17, 0.4),
    fontWeight: '700',
    color: COLORS.text,
  },
  postButton: {
    borderRadius: 18,
    paddingHorizontal: SPACING.base,
    paddingVertical: SPACING.sm,
    backgroundColor: COLORS.primary,
  },
  postButtonDisabled: {
    backgroundColor: COLORS.border,
  },
  postButtonText: {
    fontSize: FONT_SIZE.md,
    fontWeight: '700',
    color: COLORS.white,
  },
  postButtonTextDisabled: {
    color: COLORS.textMuted,
  },
  sheetBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.xs,
    paddingHorizontal: SPACING.base,
    paddingVertical: SPACING.sm,
    backgroundColor: 'rgba(255,107,107,0.06)',
  },
  sheetBannerText: {
    fontSize: FONT_SIZE.caption,
    color: COLORS.textMuted,
    fontWeight: '500',
  },
  composerInput: {
    minHeight: 110,
    maxHeight: 180,
    paddingHorizontal: SPACING.base,
    paddingTop: SPACING.md,
    fontSize: FONT_SIZE.lg,
    lineHeight: lineHeight(FONT_SIZE.lg, 1.35),
    color: COLORS.text,
  },
  composerToolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: SPACING.base,
    paddingVertical: SPACING.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.border,
  },
  toolbarEmoji: {
    fontSize: FONT_SIZE.xxl,
  },
  charCount: {
    fontSize: FONT_SIZE.caption,
    color: COLORS.textMuted,
  },
  tagSection: {
    paddingHorizontal: SPACING.base,
    paddingVertical: SPACING.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.border,
  },
  tagHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    marginBottom: SPACING.sm,
  },
  tagTitle: {
    fontSize: FONT_SIZE.md,
    fontWeight: '600',
    color: COLORS.text,
  },
  tagInput: {
    fontSize: FONT_SIZE.md,
    color: COLORS.text,
    borderRadius: 10,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    backgroundColor: COLORS.backgroundDark,
  },
  tagHint: {
    fontSize: FONT_SIZE.caption,
    color: COLORS.textMuted,
    marginTop: SPACING.xs,
  },
  selectedTagRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    padding: SPACING.sm,
    borderRadius: 10,
    backgroundColor: 'rgba(255,107,107,0.08)',
  },
  tagAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
  },
  tagAvatarFallback: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.primary,
  },
  tagName: {
    fontSize: FONT_SIZE.md,
    fontWeight: '600',
    color: COLORS.text,
  },
  suggestionList: {
    marginTop: SPACING.sm,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.white,
    overflow: 'hidden',
  },
  suggestionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.border,
  },
  suggestionAvatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.primary,
  },
  suggestionName: {
    fontSize: FONT_SIZE.md,
    fontWeight: '600',
    color: COLORS.text,
  },
  suggestionHint: {
    fontSize: FONT_SIZE.sm,
    color: COLORS.textMuted,
  },
  visibilityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: SPACING.base,
    paddingVertical: SPACING.md,
  },
  visibilityInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.md,
    flex: 1,
  },
  visibilityTitle: {
    fontSize: moderateScale(15, 0.4),
    fontWeight: '600',
    color: COLORS.text,
  },
  visibilitySubtitle: {
    fontSize: FONT_SIZE.caption,
    color: COLORS.textMuted,
    marginTop: SPACING.xxs,
  },
  duplicateOverlay: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: SPACING.xl,
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  duplicateSheet: {
    width: '100%',
    maxWidth: 340,
    borderRadius: 16,
    padding: SPACING.lg,
    backgroundColor: COLORS.white,
  },
  duplicateTitle: {
    fontSize: moderateScale(17, 0.4),
    fontWeight: '700',
    color: COLORS.text,
    textAlign: 'center',
    marginBottom: SPACING.xs,
  },
  duplicateSubtitle: {
    fontSize: FONT_SIZE.body2,
    color: COLORS.textMuted,
    textAlign: 'center',
    marginBottom: SPACING.base,
  },
  duplicateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.md,
    paddingVertical: SPACING.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: COLORS.border,
  },
  duplicateAvatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
  },
  duplicateAvatarFallback: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.primary,
  },
  duplicateName: {
    fontSize: moderateScale(15, 0.4),
    fontWeight: '600',
    color: COLORS.text,
  },
  duplicateHint: {
    fontSize: FONT_SIZE.caption,
    color: COLORS.textMuted,
    marginTop: SPACING.xxs,
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
  taggedCardAuthor: {
    fontSize: FONT_SIZE.body2,
    fontWeight: '600',
    color: COLORS.text,
  },
  taggedCardTime: {
    fontSize: FONT_SIZE.caption,
    color: COLORS.textMuted,
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
