/**
 * CONFESSION THREAD - PREMIUM UI
 * Matches the visual language of the Confession homepage.
 * Uses same colors, spacing, typography, and card styling patterns.
 *
 * Comment identity model (matches confession posting):
 *   - anonymous   : no photo, no name, no age, no gender
 *   - blur_photo  : blurred photo + name + age + gender symbol
 *   - open        : full photo + name + age + gender symbol
 *
 * Expiry rule: comments must never outlive their parent confession.
 * When the confession is missing/deleted/expired, the thread is rendered as
 * closed: no composer, no edit controls, no owner-reply affordance.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  Easing,
  FlatList,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMutation, useQuery } from 'convex/react';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';

import { api } from '@/convex/_generated/api';
import { COLORS, FONT_SIZE, SPACING, lineHeight, moderateScale } from '@/lib/constants';
import { CONFESSION_BLUR_PHOTO_RADIUS } from '@/lib/confessionBlur';
import { pickHeroPhoto } from '@/lib/confessionPhoto';
import { isContentClean } from '@/lib/contentFilter';
import { isDemoMode } from '@/hooks/useConvex';
import { safePush } from '@/lib/safeRouter';
import { useAuthStore } from '@/stores/authStore';
import { useConfessionStore } from '@/stores/confessionStore';
import {
  ReportConfessionSheet,
  ReportReasonKey,
} from '@/components/confessions/ReportConfessionSheet';
import { ConfessionMenuSheet } from '@/components/confessions/ConfessionMenuSheet';

type IdentityMode = 'anonymous' | 'blur_photo' | 'open';

type IdentityOption = {
  key: IdentityMode;
  label: string;
  description: string;
  icon: keyof typeof Ionicons.glyphMap;
};

const IDENTITY_OPTIONS: IdentityOption[] = [
  { key: 'anonymous',  label: 'Anonymous',    description: 'No name, no photo', icon: 'eye-off-outline' },
  { key: 'blur_photo', label: 'Blurred photo', description: 'Name visible, photo blurred', icon: 'contrast-outline' },
  { key: 'open',       label: 'Open to all',  description: 'Name and photo visible', icon: 'person-outline' },
];

const CONFESSION_REPLY_PAGE_LIMIT = 50;

type Reply = {
  _id: string;
  confessionId: string;
  userId: string;
  text: string;
  isAnonymous: boolean;
  identityMode?: IdentityMode | string;
  type?: string;
  voiceUrl?: string;
  voiceDurationSec?: number;
  parentReplyId?: string;
  authorName?: string;
  authorPhotoUrl?: string;
  authorAge?: number;
  authorGender?: string;
  editedAt?: number;
  createdAt: number;
  isOwnReply?: boolean;
};

type RepliesQueryResult =
  | Reply[]
  | {
      replies?: Reply[];
      hasMore?: boolean;
      limit?: number;
    };

type Confession = {
  _id: string;
  userId: string;
  text: string;
  isAnonymous: boolean;
  authorVisibility?: 'anonymous' | 'open' | 'blur_photo';
  mood: string;
  authorName?: string;
  authorPhotoUrl?: string;
  authorAge?: number;
  authorGender?: string;
  replyCount: number;
  reactionCount: number;
  createdAt: number;
  expiresAt?: number;
  isExpired?: boolean;
  isDeleted?: boolean;
  taggedUserId?: string;
  taggedUserName?: string;
};

type ConfessionConnectStatusValue =
  | 'pending'
  | 'mutual'
  | 'rejected_by_from'
  | 'rejected_by_to'
  | 'cancelled_by_from'
  | 'expired';

type ConfessionConnectViewerRole = 'requester' | 'owner' | null;
type ConfessionConnectIneligibleReason =
  | 'self'
  | 'user_ineligible'
  | 'blocked'
  | 'reported'
  | 'already_matched'
  | 'already_conversing';

type ConfessionConnectStatusResult = {
  exists: boolean;
  connectId?: string;
  status?: ConfessionConnectStatusValue;
  viewerRole: ConfessionConnectViewerRole;
  canRequest: boolean;
  canRespond: boolean;
  canCancel: boolean;
  expiresAt?: number;
  respondedAt?: number;
  conversationId?: string;
  ineligibleReason?: ConfessionConnectIneligibleReason;
  existingConversationId?: string;
  existingMatchId?: string;
};

type ConfessionConnectMutationResult = {
  status?: ConfessionConnectStatusValue;
  conversationId?: string;
  matchId?: string;
  otherUserId?: string;
  partnerUserId?: string;
  ineligibleReason?: ConfessionConnectIneligibleReason;
  existingConversationId?: string;
  existingMatchId?: string;
};

// Match homepage avatar size
const AVATAR_SIZE = moderateScale(22, 0.3);
const REPLY_AVATAR_SIZE = moderateScale(22, 0.3);

// Destructive action color for the Delete button in the comment action modal.
// Distinct from COLORS.primary (brand coral) so Edit and Delete read as
// different roles at a glance.
const MENU_DANGER = '#DC2626';

function formatTimeAgo(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp;
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  return `${days}d ago`;
}

function formatAbsoluteDate(timestamp: number | undefined): string | null {
  if (timestamp === undefined || !Number.isFinite(timestamp)) return null;
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(new Date(timestamp));
}

function computeAge(dateOfBirth: string | undefined): number | undefined {
  if (!dateOfBirth) return undefined;
  const dob = new Date(dateOfBirth);
  if (Number.isNaN(dob.getTime())) return undefined;
  const now = new Date();
  let age = now.getFullYear() - dob.getFullYear();
  const m = now.getMonth() - dob.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < dob.getDate())) age -= 1;
  return age >= 0 ? age : undefined;
}

// Normalize identityMode from any source (new backend, legacy 'blur', or missing field).
function canonicalMode(raw: string | undefined, isAnonymousFallback: boolean): IdentityMode {
  switch (raw) {
    case 'anonymous':
      return 'anonymous';
    case 'blur':
    case 'blur_photo':
      return 'blur_photo';
    case 'open':
      return 'open';
    default:
      return isAnonymousFallback ? 'anonymous' : 'open';
  }
}

// Gender symbol rendering — male blue, female pink, everything else neutral.
function GenderSymbol({ gender }: { gender?: string }) {
  if (!gender) return null;
  const lower = gender.toLowerCase();
  if (lower === 'male') {
    return <Ionicons name="male" size={12} color="#3B82F6" style={styles.genderIcon} />;
  }
  if (lower === 'female' || lower === 'lesbian') {
    return <Ionicons name="female" size={12} color="#EC4899" style={styles.genderIcon} />;
  }
  return null;
}

export default function ConfessionThreadScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { confessionId } = useLocalSearchParams<{ confessionId: string }>();
  const userId = useAuthStore((s) => s.userId);
  const token = useAuthStore((s) => s.token);
  const currentUserId = isDemoMode ? (userId || 'demo_user_1') : userId;

  // Demo mode stores
  const demoConfessions = useConfessionStore((s) => s.confessions);
  const demoReplies = useConfessionStore((s) => s.replies);
  const demoAddReply = useConfessionStore((s) => s.addReply);
  const demoDeleteReply = useConfessionStore((s) => s.deleteReply);
  const demoDeleteConfession = useConfessionStore((s) => s.deleteConfession);
  const demoReportConfession = useConfessionStore((s) => s.reportConfession);

  // Convex queries - only run in non-demo mode
  const convexConfession = useQuery(
    api.confessions.getConfession,
    !isDemoMode && confessionId && token
      ? {
          confessionId: confessionId as any,
          token,
        }
      : 'skip'
  );
  const convexReplies = useQuery(
    api.confessions.getReplies,
    !isDemoMode && confessionId && token
      ? {
          confessionId: confessionId as any,
          token,
          limit: CONFESSION_REPLY_PAGE_LIMIT,
        }
      : 'skip'
  );
  const convexMyReply = useQuery(
    api.confessions.getMyReplyForConfession,
    !isDemoMode && confessionId && token
      ? {
          confessionId: confessionId as any,
          token,
        }
      : 'skip'
  );
  const convexCurrentUser = useQuery(
    api.users.getCurrentUser,
    !isDemoMode && token
      ? { token }
      : 'skip'
  );
  // Local reply previews use the same safe frontend hero photo picker as the
  // composer. Persisted Confess payloads still come from server-owned snapshots.
  const primaryPhotos = useQuery(
    api.photos.getUserPhotos,
    !isDemoMode && currentUserId ? { userId: currentUserId } : 'skip'
  );
  const createReplyMutation = useMutation(api.confessions.createReply);
  const updateReplyMutation = useMutation(api.confessions.updateReply);
  const deleteReplyMutation = useMutation(api.confessions.deleteReply);
  const reportReplyMutation = useMutation(api.confessions.reportReply);
  const deleteConfessionMutation = useMutation(api.confessions.deleteConfession);
  const reportConfessionMutation = useMutation(api.confessions.reportConfession);
  const consumeTagProfileViewGrantMutation = useMutation(
    api.confessions.consumeConfessionTagProfileViewGrant
  );
  const requestConfessionConnectMutation = useMutation(api.confessions.requestConfessionConnect);
  const respondToConfessionConnectMutation = useMutation(api.confessions.respondToConfessionConnect);
  const cancelConfessionConnectMutation = useMutation(api.confessions.cancelConfessionConnect);
  const connectStatus = useQuery(
    api.confessions.getConfessionConnectStatus,
    !isDemoMode && token && confessionId
      ? { token, confessionId: confessionId as any }
      : 'skip'
  ) as ConfessionConnectStatusResult | undefined;

  // Composer state
  const [replyText, setReplyText] = useState('');
  const [identityMode, setIdentityMode] = useState<IdentityMode>('anonymous');
  const [composerMode, setComposerMode] = useState<'create' | 'edit' | 'owner-reply'>('create');
  const [editingReplyId, setEditingReplyId] = useState<string | null>(null);
  const [replyingToReplyId, setReplyingToReplyId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [connectAction, setConnectAction] = useState<'request' | 'cancel' | 'connect' | 'reject' | null>(null);
  const [connectDismissed, setConnectDismissed] = useState(false);
  const inputRef = useRef<TextInput>(null);
  const [refreshing, setRefreshing] = useState(false);
  const refreshTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Long-press menu state (viewer's own comment).
  const [menuReplyId, setMenuReplyId] = useState<string | null>(null);
  const [reportingReplyId, setReportingReplyId] = useState<string | null>(null);
  // Long-press menu state for the hero confession (Edit/Delete owner,
  // Report non-owner). Mirrors the homepage feed plumbing so the same
  // ConfessionMenuSheet drives both surfaces.
  const [showConfessionMenu, setShowConfessionMenu] = useState(false);
  const [reportingMainConfessionId, setReportingMainConfessionId] = useState<string | null>(null);
  const menuVisible = !!menuReplyId;
  const menuOpacity = useRef(new Animated.Value(0)).current;
  const menuScale = useRef(new Animated.Value(0.92)).current;
  useEffect(() => {
    if (menuVisible) {
      menuOpacity.setValue(0);
      menuScale.setValue(0.92);
      Animated.parallel([
        Animated.timing(menuOpacity, {
          toValue: 1,
          duration: 160,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.spring(menuScale, {
          toValue: 1,
          damping: 18,
          stiffness: 220,
          mass: 0.6,
          useNativeDriver: true,
        }),
      ]).start();
    }
  }, [menuVisible, menuOpacity, menuScale]);

  useEffect(() => {
    return () => {
      if (refreshTimeoutRef.current) {
        clearTimeout(refreshTimeoutRef.current);
      }
    };
  }, []);

  const handleRefresh = useCallback(() => {
    setRefreshing(true);
    if (refreshTimeoutRef.current) {
      clearTimeout(refreshTimeoutRef.current);
    }
    refreshTimeoutRef.current = setTimeout(() => {
      setRefreshing(false);
    }, 450);
  }, []);

  // Get confession data
  const confession: Confession | null = isDemoMode
    ? (demoConfessions.find((c) => c.id === confessionId) as unknown as Confession | undefined) ?? null
    : convexConfession ?? null;

  // Get replies
  const liveRepliesResult = convexReplies as RepliesQueryResult | undefined;
  const liveReplies = Array.isArray(liveRepliesResult)
    ? liveRepliesResult
    : liveRepliesResult?.replies ?? [];
  const repliesHasMore =
    !isDemoMode &&
    !!liveRepliesResult &&
    !Array.isArray(liveRepliesResult) &&
    liveRepliesResult.hasMore === true;

  const replies: Reply[] = isDemoMode
    ? (demoReplies[confessionId ?? ''] ?? []).map((r: any) => ({
        _id: r.id,
        confessionId: confessionId ?? '',
        userId: r.userId,
        text: r.text,
        isAnonymous: r.isAnonymous,
        identityMode: r.identityMode,
        type: r.type,
        voiceUrl: r.voiceUrl,
        voiceDurationSec: r.voiceDurationSec,
        createdAt: r.createdAt,
      }))
    : liveReplies;

  const myExistingReply: Reply | null = isDemoMode
    ? (replies.find((r) => r.userId === currentUserId && !r.parentReplyId) ?? null)
    : ((convexMyReply ?? null) as Reply | null);

  const isLoading = !isDemoMode && (convexConfession === undefined || convexReplies === undefined);

  // Group replies into top-level comments and owner-reply children keyed by
  // their parent reply id. Owner replies (with parentReplyId) are rendered
  // INLINE inside the parent comment card — they never appear in the main
  // FlatList as standalone cards.
  const { topLevelReplies, childrenByParent } = useMemo(() => {
    const top: Reply[] = [];
    const byParent: Record<string, Reply[]> = {};
    for (const r of replies) {
      if (r.parentReplyId) {
        const list = byParent[r.parentReplyId] ?? [];
        list.push(r);
        byParent[r.parentReplyId] = list;
      } else {
        top.push(r);
      }
    }
    // Chronological order for children (oldest first).
    for (const k of Object.keys(byParent)) {
      byParent[k]!.sort((a, b) => a.createdAt - b.createdAt);
    }
    return { topLevelReplies: top, childrenByParent: byParent };
  }, [replies]);

  // Expiry gate — every comment action must fail closed when the parent is gone.
  const isOwner = !!confession && confession.userId === currentUserId;
  const isOwnerExpiredReadOnly = Boolean(
    confession?.isExpired && confession.userId === currentUserId
  );
  const now = Date.now();
  const isThreadClosed =
    !confession ||
    !!confession.isDeleted ||
    (confession.expiresAt !== undefined && confession.expiresAt <= now);
  const commentsInteractive = !isThreadClosed && !isOwnerExpiredReadOnly;
  const expiredDateLabel = formatAbsoluteDate(confession?.expiresAt);
  const closedThreadMessage = expiredDateLabel
    ? `This confession expired on ${expiredDateLabel}. Comments are closed.`
    : 'This confession has expired. Comments are closed.';

  // If the thread closes mid-session (e.g. 2-minute expiry fires), drop any active
  // composer state so no stale edit/reply UI remains on screen.
  useEffect(() => {
    if (isThreadClosed) {
      setComposerMode('create');
      setEditingReplyId(null);
      setReplyingToReplyId(null);
      setReplyText('');
      setMenuReplyId(null);
    }
  }, [isThreadClosed]);

  const handleBack = useCallback(() => {
    router.back();
  }, [router]);

  const openMessagesConversation = useCallback((conversationId?: string | null) => {
    const normalized = typeof conversationId === 'string' ? conversationId.trim() : '';
    if (!normalized) {
      Alert.alert('Chat unavailable', 'The conversation is not ready yet.');
      return;
    }
    safePush(
      router,
      `/(main)/(tabs)/messages/chat/${normalized}` as any,
      'thread->confessConnectChat'
    );
  }, [router]);

  const openConnectCelebration = useCallback((
    conversationId?: string | null,
    matchId?: string | null,
    otherUserId?: string | null
  ) => {
    const normalized = typeof conversationId === 'string' ? conversationId.trim() : '';
    if (!normalized) {
      Alert.alert('Connected', 'The chat is being prepared. Please try opening it again.');
      return;
    }
    const params = new URLSearchParams({
      conversationId: normalized,
      source: 'confession',
      phase: 'phase1',
    });
    const normalizedMatchId = typeof matchId === 'string' ? matchId.trim() : '';
    if (normalizedMatchId) {
      params.set('matchId', normalizedMatchId);
    }
    const normalizedOtherUserId = typeof otherUserId === 'string' ? otherUserId.trim() : '';
    if (normalizedOtherUserId) {
      params.set('userId', normalizedOtherUserId);
      params.set('otherUserId', normalizedOtherUserId);
    }
    safePush(
      router,
      `/(main)/match-celebration?${params.toString()}` as any,
      'thread->confessConnectCelebration'
    );
  }, [router]);

  const handleRequestConnect = useCallback(async () => {
    if (isDemoMode) {
      setConnectDismissed(false);
      Alert.alert('Demo mode', 'Connect requests are available in live mode.');
      return;
    }
    if (!token || !confessionId || connectAction) return;
    setConnectAction('request');
    try {
      const result = await requestConfessionConnectMutation({
        token,
        confessionId: confessionId as any,
      }) as ConfessionConnectMutationResult;
      setConnectDismissed(false);
      if (result?.status === 'mutual' && result.conversationId) {
        openConnectCelebration(
          result.conversationId,
          result.matchId,
          result.otherUserId ?? result.partnerUserId
        );
      } else {
        Alert.alert('Request sent', 'Waiting for them to connect.');
      }
    } catch (error: any) {
      Alert.alert('Connect unavailable', error?.message || 'Please try again later.');
    } finally {
      setConnectAction(null);
    }
  }, [
    confessionId,
    connectAction,
    isDemoMode,
    openConnectCelebration,
    requestConfessionConnectMutation,
    token,
  ]);

  const handleSkipConnect = useCallback(async () => {
    if (!connectStatus?.connectId || !connectStatus.canCancel || !token || connectAction) {
      setConnectDismissed(true);
      return;
    }
    setConnectAction('cancel');
    try {
      await cancelConfessionConnectMutation({
        token,
        connectId: connectStatus.connectId as any,
      });
    } catch (error: any) {
      Alert.alert('Unable to cancel', error?.message || 'Please try again later.');
    } finally {
      setConnectAction(null);
    }
  }, [cancelConfessionConnectMutation, connectAction, connectStatus, token]);

  const handleOwnerConnectDecision = useCallback(async (decision: 'connect' | 'reject') => {
    if (!connectStatus?.connectId || !token || connectAction) {
      Alert.alert('Connect unavailable', 'This request is not ready yet.');
      return;
    }
    setConnectAction(decision);
    try {
      const result = await respondToConfessionConnectMutation({
        token,
        connectId: connectStatus.connectId as any,
        decision,
      }) as ConfessionConnectMutationResult;

      if (decision === 'connect') {
        if (result?.conversationId) {
          openConnectCelebration(
            result.conversationId,
            result.matchId,
            result.otherUserId ?? result.partnerUserId
          );
        } else {
          Alert.alert('Connected', 'The chat is being prepared. Please try opening it again.');
        }
      } else {
        Alert.alert('Request rejected', 'This connect request has been closed.');
      }
    } catch (error: any) {
      Alert.alert('Connect unavailable', error?.message || 'Please try again later.');
    } finally {
      setConnectAction(null);
    }
  }, [
    connectAction,
    connectStatus,
    openConnectCelebration,
    respondToConfessionConnectMutation,
    token,
  ]);

  // Snapshot author info. The backend still owns persisted Confess snapshots;
  // this frontend helper only keeps local optimistic/demo previews consistent.
  const getAuthorInfo = useCallback(
    (mode: IdentityMode) => {
      if (mode === 'anonymous') return {};
      if (!isDemoMode && convexCurrentUser) {
        return {
          authorName: (convexCurrentUser as any).name as string | undefined,
          authorPhotoUrl: pickHeroPhoto(primaryPhotos as any),
          authorAge: computeAge((convexCurrentUser as any).dateOfBirth),
          authorGender: (convexCurrentUser as any).gender as string | undefined,
        };
      }
      return {};
    },
    [convexCurrentUser, isDemoMode, primaryPhotos]
  );

  const resetComposer = useCallback(() => {
    setComposerMode('create');
    setEditingReplyId(null);
    setReplyingToReplyId(null);
    setReplyText('');
    setIdentityMode('anonymous');
  }, []);

  // ────────────────────────────────────────────────────────────
  // Composer actions
  // ────────────────────────────────────────────────────────────
  const handleSubmitReply = useCallback(async () => {
    if (!currentUserId || !confessionId || submitting) return;
    if (isThreadClosed) {
      Alert.alert('Thread closed', 'This confession is no longer available.');
      return;
    }

    const trimmed = replyText.trim();
    if (trimmed.length < 1) {
      Alert.alert('Empty Reply', 'Please write something.');
      return;
    }

    if (!isContentClean(trimmed)) {
      Alert.alert('Content Warning', 'Your reply contains inappropriate content.');
      return;
    }

    setSubmitting(true);
    Keyboard.dismiss();

    try {
      if (composerMode === 'edit' && editingReplyId) {
        if (isDemoMode) {
          // Demo fallback: best-effort local update is out of scope; keep parity with live.
          Alert.alert('Not available in demo', 'Editing comments is available in live mode.');
        } else {
          const authorInfo = getAuthorInfo(identityMode);
          await updateReplyMutation({
            replyId: editingReplyId as any,
            token: token ?? '',
            userId: currentUserId,
            text: trimmed,
            identityMode,
            ...(authorInfo.authorName ? { authorName: authorInfo.authorName } : {}),
            ...(authorInfo.authorPhotoUrl ? { authorPhotoUrl: authorInfo.authorPhotoUrl } : {}),
            ...(authorInfo.authorAge !== undefined ? { authorAge: authorInfo.authorAge } : {}),
            ...(authorInfo.authorGender ? { authorGender: authorInfo.authorGender } : {}),
          });
        }
      } else {
        const authorInfo = getAuthorInfo(identityMode);
        if (isDemoMode) {
          demoAddReply(confessionId, {
            id: `reply_${Date.now()}`,
            confessionId,
            userId: currentUserId,
            text: trimmed,
            isAnonymous: identityMode === 'anonymous',
            identityMode,
            type: 'text',
            createdAt: Date.now(),
          } as any);
        } else {
          await createReplyMutation({
            confessionId: confessionId as any,
            token: token ?? '',
            userId: currentUserId,
            text: trimmed,
            isAnonymous: identityMode === 'anonymous',
            identityMode,
            type: 'text',
            ...(composerMode === 'owner-reply' && replyingToReplyId
              ? { parentReplyId: replyingToReplyId as any }
              : {}),
            ...(authorInfo.authorName ? { authorName: authorInfo.authorName } : {}),
            ...(authorInfo.authorPhotoUrl ? { authorPhotoUrl: authorInfo.authorPhotoUrl } : {}),
            ...(authorInfo.authorAge !== undefined ? { authorAge: authorInfo.authorAge } : {}),
            ...(authorInfo.authorGender ? { authorGender: authorInfo.authorGender } : {}),
          });
        }
      }

      resetComposer();
    } catch (error: any) {
      Alert.alert('Error', error?.message || 'Failed to post reply');
    } finally {
      setSubmitting(false);
    }
  }, [
    composerMode,
    confessionId,
    createReplyMutation,
    currentUserId,
    demoAddReply,
    editingReplyId,
    getAuthorInfo,
    identityMode,
    isThreadClosed,
    replyText,
    replyingToReplyId,
    resetComposer,
    submitting,
    token,
    updateReplyMutation,
  ]);

  // The specific reply targeted by an open long-press menu. Ownership drives
  // whether the menu shows Edit/Delete (own) or Report (someone else's).
  const menuTargetReply: Reply | null = useMemo(() => {
    if (!menuReplyId) return null;
    return replies.find((r) => r._id === menuReplyId) ?? null;
  }, [menuReplyId, replies]);

  const menuTargetIsOwn =
    !!menuTargetReply &&
    !!currentUserId &&
    (menuTargetReply.userId === currentUserId || !!menuTargetReply.isOwnReply);

  const handleBeginEdit = useCallback(() => {
    if (!menuTargetReply || isThreadClosed) return;
    setComposerMode('edit');
    setEditingReplyId(menuTargetReply._id);
    setReplyingToReplyId(null);
    setReplyText(menuTargetReply.text);
    setIdentityMode(
      canonicalMode(
        menuTargetReply.identityMode as string | undefined,
        !!menuTargetReply.isAnonymous
      )
    );
    setMenuReplyId(null);
    // Let the system focus the input on next tick.
    setTimeout(() => inputRef.current?.focus(), 50);
  }, [isThreadClosed, menuTargetReply]);

  const handleDelete = useCallback(async () => {
    if (!currentUserId || !menuTargetReply || isThreadClosed) return;
    const targetId = menuTargetReply._id;
    // Derive ownership from the reply itself so a stale/null myExistingReply
    // query can never swallow the composer reset.
    const targetIsMine =
      menuTargetReply.userId === currentUserId || !!menuTargetReply.isOwnReply;
    const targetIsMyTopLevel = targetIsMine && !menuTargetReply.parentReplyId;
    const targetIsBeingEdited = editingReplyId === targetId;
    setMenuReplyId(null);
    Alert.alert(
      'Delete comment',
      'Are you sure you want to delete your comment? You can comment again after deleting.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              if (isDemoMode) {
                // Demo parity with live — actually remove the row locally so
                // myExistingReply (derived from replies[]) becomes null and
                // the "already commented" footer disappears.
                if (confessionId) {
                  demoDeleteReply(confessionId as string, targetId);
                }
              } else {
                await deleteReplyMutation({
                  replyId: targetId as any,
                  token: token ?? '',
                  userId: currentUserId,
                });
              }
              // Unconditionally clear composer state when the deleted reply
              // was mine (whether top-level or inline owner-reply) OR was the
              // one currently being edited. This guarantees the user can post
              // again immediately — no reliance on passive query refresh to
              // clear stale edit/reply/"already commented" UI.
              if (targetIsMyTopLevel || targetIsBeingEdited || targetIsMine) {
                resetComposer();
              }
            } catch (error: any) {
              Alert.alert('Error', error?.message || 'Failed to delete comment');
            }
          },
        },
      ]
    );
  }, [
    confessionId,
    currentUserId,
    deleteReplyMutation,
    demoDeleteReply,
    editingReplyId,
    isThreadClosed,
    menuTargetReply,
    resetComposer,
    token,
  ]);

  const handleReport = useCallback(() => {
    if (!currentUserId || !menuTargetReply || isThreadClosed) return;
    const targetId = menuTargetReply._id;
    setMenuReplyId(null);
    setReportingReplyId(targetId);
  }, [currentUserId, isThreadClosed, menuTargetReply]);

  const handleSubmitReplyReport = useCallback(async (reason: ReportReasonKey) => {
    const targetId = reportingReplyId;
    if (!currentUserId || !targetId || isThreadClosed) return;
    try {
      if (isDemoMode) {
        Alert.alert('Reported', "Thanks. We'll review this comment.");
        return;
      }
      await reportReplyMutation({
        replyId: targetId as any,
        token: token ?? '',
        reporterId: currentUserId,
        reason,
      });
      Alert.alert('Reported', "Thanks. We'll review this comment.");
    } catch (error: any) {
      Alert.alert('Error', error?.message || 'Failed to report comment');
    } finally {
      setReportingReplyId(null);
    }
  }, [currentUserId, isDemoMode, isThreadClosed, reportReplyMutation, reportingReplyId, token]);

  // ────────────────────────────────────────────────────────────
  // Hero-confession long-press menu (mirrors the homepage menu sheet)
  // ────────────────────────────────────────────────────────────
  const handleOpenConfessionMenu = useCallback(() => {
    if (!confession) return;
    setShowConfessionMenu(true);
  }, [confession]);

  const handleCloseConfessionMenu = useCallback(() => {
    setShowConfessionMenu(false);
  }, []);

  const handleConfessionMenuEdit = useCallback(() => {
    if (!confession) return;
    safePush(
      router,
      {
        pathname: '/(main)/compose-confession',
        params: {
          editId: String(confession._id),
          mode: 'edit',
        },
      } as any,
      'confession-thread->editConfession'
    );
  }, [confession, router]);

  const handleConfessionMenuDelete = useCallback(() => {
    if (!confession || !currentUserId) return;
    const targetId = String(confession._id);
    if (confession.userId !== currentUserId) return;
    Alert.alert('Delete Confession', 'This action cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            if (isDemoMode) {
              demoDeleteConfession(targetId);
            } else {
              await deleteConfessionMutation({
                confessionId: targetId as any,
                token: token ?? '',
                userId: currentUserId,
              });
            }
            // Leave the thread — the confession no longer exists.
            if (router.canGoBack?.()) router.back();
          } catch (error: any) {
            Alert.alert('Error', error?.message || 'Unable to delete right now');
          }
        },
      },
    ]);
  }, [confession, currentUserId, deleteConfessionMutation, demoDeleteConfession, isDemoMode, router, token]);

  const handleConfessionMenuReport = useCallback(() => {
    if (!confession) return;
    setReportingMainConfessionId(String(confession._id));
  }, [confession]);

  const handleSubmitMainConfessionReport = useCallback(async (reason: ReportReasonKey) => {
    const targetId = reportingMainConfessionId;
    if (!targetId) return;
    try {
      if (isDemoMode) {
        demoReportConfession(targetId);
        Alert.alert('Reported', "Thanks. We'll review this confession.");
        return;
      }
      if (!currentUserId) return;
      await reportConfessionMutation({
        confessionId: targetId as any,
        token: token ?? '',
        reporterId: currentUserId,
        reason,
      });
      Alert.alert('Reported', "Thanks. We'll review this confession.");
    } catch (error: any) {
      Alert.alert('Error', error?.message || 'Unable to report right now');
    } finally {
      setReportingMainConfessionId(null);
    }
  }, [currentUserId, demoReportConfession, isDemoMode, reportConfessionMutation, reportingMainConfessionId, token]);

  const handleBeginOwnerReply = useCallback(
    (parentReply: Reply) => {
      if (!isOwner || isThreadClosed || !confession) return;
      // Owner reply always inherits the confession's identity mode — the user
      // does NOT choose a new identity per reply. Whatever visibility the
      // confession was posted with is reused here.
      const confessionVisibility =
        (confession.authorVisibility as string | undefined) ||
        (confession.isAnonymous ? 'anonymous' : 'open');
      const inheritedMode: IdentityMode = canonicalMode(
        confessionVisibility,
        !!confession.isAnonymous
      );
      setComposerMode('owner-reply');
      setEditingReplyId(null);
      setReplyingToReplyId(parentReply._id);
      setReplyText('');
      setIdentityMode(inheritedMode);
      setTimeout(() => inputRef.current?.focus(), 50);
    },
    [confession, isOwner, isThreadClosed]
  );

  // ────────────────────────────────────────────────────────────
  // Render helpers
  // ────────────────────────────────────────────────────────────
  const replyingToParent: Reply | null = useMemo(() => {
    if (composerMode !== 'owner-reply' || !replyingToReplyId) return null;
    return replies.find((r) => r._id === replyingToReplyId) ?? null;
  }, [composerMode, replies, replyingToReplyId]);

  const renderReplyAvatar = useCallback((mode: IdentityMode, photoUrl?: string) => {
    if (mode === 'anonymous') {
      return (
        <View style={[styles.replyAvatar, styles.replyAvatarAnon]}>
          <Ionicons name="eye-off" size={12} color={COLORS.textMuted} />
        </View>
      );
    }
    if (mode === 'blur_photo' && photoUrl) {
      return (
        <Image
          source={{ uri: photoUrl }}
          style={styles.replyAvatarImage}
          contentFit="cover"
          blurRadius={CONFESSION_BLUR_PHOTO_RADIUS}
        />
      );
    }
    if (mode === 'open' && photoUrl) {
      return (
        <Image
          source={{ uri: photoUrl }}
          style={styles.replyAvatarImage}
          contentFit="cover"
        />
      );
    }
    return (
      <View style={styles.replyAvatar}>
        <Ionicons name="person" size={12} color={COLORS.primary} />
      </View>
    );
  }, []);

  // Render an inline owner reply that appears INSIDE the parent comment card.
  // This is never a standalone FlatList row — it's a nested block only.
  const renderInlineOwnerReply = useCallback(
    (child: Reply) => {
      const ownChild = child.userId === currentUserId || !!child.isOwnReply;
      const mode = canonicalMode(child.identityMode as string | undefined, !!child.isAnonymous);
      const displayName =
        mode === 'anonymous' ? 'Anonymous' : child.authorName ? child.authorName : 'Someone';

      // Long-press is available for everyone — own replies get Edit/Delete,
      // others get Report. Closed threads are frozen.
      const onLongPress = commentsInteractive ? () => setMenuReplyId(child._id) : undefined;

      return (
        <Pressable
          key={child._id}
          onLongPress={onLongPress}
          delayLongPress={350}
          style={({ pressed }) => [
            styles.inlineReplyRow,
            pressed && ownChild && styles.replyCardPressed,
          ]}
        >
          <View style={styles.inlineReplyConnector} />
          <View style={styles.inlineReplyContent}>
            <View style={styles.inlineReplyHeaderRow}>
              {renderReplyAvatar(mode, child.authorPhotoUrl)}
              <Text
                style={[
                  styles.inlineReplyAuthor,
                  mode === 'anonymous' && styles.replyAuthorAnon,
                ]}
                numberOfLines={1}
              >
                {displayName}
                {mode !== 'anonymous' && child.authorAge ? `, ${child.authorAge}` : ''}
              </Text>
              {mode !== 'anonymous' ? <GenderSymbol gender={child.authorGender} /> : null}
              <View style={styles.inlineAuthorBadge}>
                <Text maxFontSizeMultiplier={1.2} style={styles.inlineAuthorBadgeText}>Author</Text>
              </View>
              <Text maxFontSizeMultiplier={1.2} style={styles.inlineReplyTime}>
                {formatTimeAgo(child.createdAt)}
                {child.editedAt ? ' · edited' : ''}
              </Text>
            </View>
            <Text maxFontSizeMultiplier={1.2} style={styles.inlineReplyText}>{child.text}</Text>
          </View>
        </Pressable>
      );
    },
    [commentsInteractive, currentUserId, renderReplyAvatar]
  );

  const renderReplyItem = useCallback(
    ({ item }: { item: Reply }) => {
      const ownReply = item.userId === currentUserId || !!item.isOwnReply;
      const mode = canonicalMode(item.identityMode as string | undefined, !!item.isAnonymous);

      const displayName =
        mode === 'anonymous'
          ? 'Anonymous'
          : item.authorName
          ? item.authorName
          : 'Someone';

      // Long-press works on every comment — own vs others is branched in the
      // modal (Edit/Delete vs Report). Closed threads are frozen.
      const onLongPress = commentsInteractive ? () => setMenuReplyId(item._id) : undefined;

      const children = childrenByParent[item._id] ?? [];
      const hasOwnerReply = children.length > 0;

      // One reply per comment: hide the Reply button once the owner has replied.
      const showOwnerReplyButton =
        isOwner &&
        !ownReply &&
        commentsInteractive &&
        !hasOwnerReply &&
        composerMode !== 'edit';

      return (
        <Pressable
          onLongPress={onLongPress}
          delayLongPress={350}
          style={({ pressed }) => [
            styles.replyCard,
            ownReply && styles.replyCardOwn,
            pressed && ownReply && styles.replyCardPressed,
          ]}
        >
          <View style={styles.replyHeader}>
            {renderReplyAvatar(mode, item.authorPhotoUrl)}
            <View style={styles.replyAuthorBlock}>
              <View style={styles.replyAuthorRow}>
                <Text
                  style={[
                    styles.replyAuthor,
                    ownReply && styles.replyAuthorOwn,
                    mode === 'anonymous' && styles.replyAuthorAnon,
                  ]}
                  numberOfLines={1}
                >
                  {displayName}
                  {mode !== 'anonymous' && item.authorAge ? `, ${item.authorAge}` : ''}
                </Text>
                {mode !== 'anonymous' ? <GenderSymbol gender={item.authorGender} /> : null}
                {ownReply ? <Text maxFontSizeMultiplier={1.2} style={styles.replyYouTag}> (You)</Text> : null}
              </View>
              <Text maxFontSizeMultiplier={1.2} style={styles.replyTime}>
                {formatTimeAgo(item.createdAt)}
                {item.editedAt ? ' · edited' : ''}
              </Text>
            </View>

            {showOwnerReplyButton ? (
              <TouchableOpacity
                style={styles.headerReplyBtn}
                onPress={() => handleBeginOwnerReply(item)}
                activeOpacity={0.7}
                hitSlop={6}
              >
                <Ionicons name="return-down-back-outline" size={13} color={COLORS.primary} />
                <Text maxFontSizeMultiplier={1.2} style={styles.headerReplyBtnText}>Reply</Text>
              </TouchableOpacity>
            ) : null}
          </View>

          <Text maxFontSizeMultiplier={1.2} style={styles.replyText}>{item.text}</Text>

          {hasOwnerReply ? (
            <View style={styles.inlineReplyGroup}>
              {children.map((child) => renderInlineOwnerReply(child))}
            </View>
          ) : null}
        </Pressable>
      );
    },
    [
      childrenByParent,
      composerMode,
      currentUserId,
      handleBeginOwnerReply,
      isOwner,
      commentsInteractive,
      renderInlineOwnerReply,
      renderReplyAvatar,
    ]
  );

  // Open the tagged user's profile from the hero @username chip.
  // Live mode: server validates the grant (expiry, mention match, blocks,
  // reports) before navigating. Demo mode: navigate directly.
  // Failure path uses generic copy — never reveals block/report state.
  const handleTagPress = useCallback(async (
    sourceConfessionId: string,
    profileUserId: string | undefined
  ) => {
    if (!sourceConfessionId || !profileUserId) {
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
            fromConfessionId: sourceConfessionId,
          },
        } as any,
        'thread->profile(tag)'
      );
      return;
    }

    if (!token) {
      Alert.alert('Profile unavailable');
      return;
    }

    try {
      await consumeTagProfileViewGrantMutation({
        token,
        confessionId: sourceConfessionId as any,
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
            fromConfessionId: sourceConfessionId,
          },
        } as any,
        'thread->profile(tag)'
      );
    } catch {
      Alert.alert('Profile unavailable');
    }
  }, [consumeTagProfileViewGrantMutation, router, token]);

  const renderConnectPanel = useCallback(() => {
    if (isDemoMode) return null;
    if (!token || !confessionId) return null;
    if (connectStatus === undefined) {
      return (
        <View style={styles.connectPanel}>
          <ActivityIndicator size="small" color={COLORS.primary} />
          <Text maxFontSizeMultiplier={1.2} style={styles.connectPanelText}>
            Checking connect status...
          </Text>
        </View>
      );
    }

    const status = connectStatus.status;
    const role = connectStatus.viewerRole;
    const actionBusy = connectAction !== null;
    const disabled = actionBusy || isThreadClosed;
    const alreadyConnected =
      connectStatus.ineligibleReason === 'already_matched' ||
      connectStatus.ineligibleReason === 'already_conversing';
    const alreadyConnectedConversationId =
      connectStatus.existingConversationId ?? connectStatus.conversationId;

    if (!role) return null;

    if (alreadyConnected) {
      return (
        <View style={[styles.connectPanel, styles.connectPanelSuccess]}>
          <View style={styles.connectPanelHeader}>
            <Ionicons name="checkmark-circle" size={16} color="#34C759" />
            <Text maxFontSizeMultiplier={1.2} style={styles.connectPanelTitle}>Already connected</Text>
          </View>
          {alreadyConnectedConversationId ? (
            <TouchableOpacity
              style={styles.connectPrimaryButton}
              onPress={() => openMessagesConversation(alreadyConnectedConversationId)}
              activeOpacity={0.82}
            >
              <Ionicons name="chatbubble-ellipses-outline" size={15} color={COLORS.white} />
              <Text maxFontSizeMultiplier={1.2} style={styles.connectPrimaryButtonText}>
                Already connected · Open chat
              </Text>
            </TouchableOpacity>
          ) : (
            <Text maxFontSizeMultiplier={1.2} style={styles.connectPanelText}>
              Already connected.
            </Text>
          )}
        </View>
      );
    }

    if (status === 'mutual') {
      return (
        <View style={[styles.connectPanel, styles.connectPanelSuccess]}>
          <View style={styles.connectPanelHeader}>
            <Ionicons name="checkmark-circle" size={16} color="#34C759" />
            <Text maxFontSizeMultiplier={1.2} style={styles.connectPanelTitle}>Connected</Text>
          </View>
          <Text maxFontSizeMultiplier={1.2} style={styles.connectPanelText}>
            You both connected. Continue in Messages.
          </Text>
          <TouchableOpacity
            style={styles.connectPrimaryButton}
            onPress={() => openMessagesConversation(connectStatus.conversationId)}
            disabled={!connectStatus.conversationId}
            activeOpacity={0.82}
          >
            <Ionicons name="chatbubble-ellipses-outline" size={15} color={COLORS.white} />
            <Text maxFontSizeMultiplier={1.2} style={styles.connectPrimaryButtonText}>Open Chat</Text>
          </TouchableOpacity>
        </View>
      );
    }

    if (
      status === 'rejected_by_from' ||
      status === 'rejected_by_to' ||
      status === 'cancelled_by_from' ||
      status === 'expired'
    ) {
      const copy =
        status === 'expired'
          ? 'Request expired.'
          : status === 'cancelled_by_from'
            ? 'Request cancelled.'
            : role === 'requester'
              ? 'Request declined.'
              : 'Request rejected.';
      const title =
        status === 'expired'
          ? 'Request expired'
          : status === 'cancelled_by_from'
            ? 'Request cancelled'
            : role === 'requester'
              ? 'Request declined'
              : 'Request rejected';
      return (
        <View style={styles.connectPanel}>
          <View style={styles.connectPanelHeader}>
            <Ionicons name="close-circle-outline" size={16} color={COLORS.textMuted} />
            <Text maxFontSizeMultiplier={1.2} style={styles.connectPanelTitle}>{title}</Text>
          </View>
          <Text maxFontSizeMultiplier={1.2} style={styles.connectPanelText}>{copy}</Text>
        </View>
      );
    }

    if (role === 'requester') {
      if (status === 'pending') {
        return (
          <View style={styles.connectPanel}>
            <View style={styles.connectPanelHeader}>
              <Ionicons name="time-outline" size={16} color={COLORS.primary} />
              <Text maxFontSizeMultiplier={1.2} style={styles.connectPanelTitle}>Request sent</Text>
            </View>
            <Text maxFontSizeMultiplier={1.2} style={styles.connectPanelText}>
              Waiting for them to connect. Your identity stays protected until both sides connect.
            </Text>
            {connectStatus.canCancel ? (
              <TouchableOpacity
                style={styles.connectSecondaryButton}
                onPress={handleSkipConnect}
                disabled={actionBusy}
                activeOpacity={0.82}
              >
                {connectAction === 'cancel' ? (
                  <ActivityIndicator size="small" color={COLORS.text} />
                ) : (
                  <>
                    <Ionicons name="close" size={15} color={COLORS.text} />
                    <Text maxFontSizeMultiplier={1.2} style={styles.connectSecondaryButtonText}>Cancel Request</Text>
                  </>
                )}
              </TouchableOpacity>
            ) : null}
          </View>
        );
      }

      if (!connectStatus.exists && connectStatus.canRequest && !connectDismissed) {
        return (
          <View style={styles.connectPanel}>
            <View style={styles.connectPanelHeader}>
              <Ionicons name="heart-outline" size={16} color={COLORS.primary} />
              <Text maxFontSizeMultiplier={1.2} style={styles.connectPanelTitle}>Connect?</Text>
            </View>
            <Text maxFontSizeMultiplier={1.2} style={styles.connectPanelText}>
              If you both choose Connect, Mira will open a real Messages chat. Your identity stays protected until both sides connect.
            </Text>
            <View style={styles.connectButtonRow}>
              <TouchableOpacity
                style={[styles.connectPrimaryButton, disabled && styles.connectButtonDisabled]}
                onPress={handleRequestConnect}
                disabled={disabled}
                activeOpacity={0.82}
              >
                {connectAction === 'request' ? (
                  <ActivityIndicator size="small" color={COLORS.white} />
                ) : (
                  <>
                    <Ionicons name="heart" size={15} color={COLORS.white} />
                    <Text maxFontSizeMultiplier={1.2} style={styles.connectPrimaryButtonText}>Connect</Text>
                  </>
                )}
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.connectSecondaryButton}
                onPress={handleSkipConnect}
                disabled={actionBusy}
                activeOpacity={0.82}
              >
                <Ionicons name="close" size={15} color={COLORS.text} />
                <Text maxFontSizeMultiplier={1.2} style={styles.connectSecondaryButtonText}>Skip</Text>
              </TouchableOpacity>
            </View>
          </View>
        );
      }

      if (connectDismissed) {
        return (
          <View style={styles.connectPanel}>
            <Text maxFontSizeMultiplier={1.2} style={styles.connectPanelText}>
              Connect skipped for now.
            </Text>
          </View>
        );
      }
    }

    if (role === 'owner') {
      if (status === 'pending' && connectStatus.canRespond) {
        return (
          <View style={styles.connectPanel}>
            <View style={styles.connectPanelHeader}>
              <Ionicons name="heart-outline" size={16} color={COLORS.primary} />
              <Text maxFontSizeMultiplier={1.2} style={styles.connectPanelTitle}>Connect request</Text>
            </View>
            <Text maxFontSizeMultiplier={1.2} style={styles.connectPanelText}>
              Someone wants to connect from your confession. Your identity stays protected until both sides connect.
            </Text>
            <View style={styles.connectButtonRow}>
              <TouchableOpacity
                style={[styles.connectPrimaryButton, disabled && styles.connectButtonDisabled]}
                onPress={() => void handleOwnerConnectDecision('connect')}
                disabled={disabled}
                activeOpacity={0.82}
              >
                {connectAction === 'connect' ? (
                  <ActivityIndicator size="small" color={COLORS.white} />
                ) : (
                  <>
                    <Ionicons name="checkmark" size={15} color={COLORS.white} />
                    <Text maxFontSizeMultiplier={1.2} style={styles.connectPrimaryButtonText}>Connect</Text>
                  </>
                )}
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.connectSecondaryButton}
                onPress={() => void handleOwnerConnectDecision('reject')}
                disabled={actionBusy}
                activeOpacity={0.82}
              >
                {connectAction === 'reject' ? (
                  <ActivityIndicator size="small" color={COLORS.text} />
                ) : (
                  <>
                    <Ionicons name="close" size={15} color={COLORS.text} />
                    <Text maxFontSizeMultiplier={1.2} style={styles.connectSecondaryButtonText}>Reject</Text>
                  </>
                )}
              </TouchableOpacity>
            </View>
          </View>
        );
      }

      if (!connectStatus.exists) {
        return null;
      }
    }

    return null;
  }, [
    confessionId,
    connectAction,
    connectDismissed,
    connectStatus,
    handleOwnerConnectDecision,
    handleRequestConnect,
    handleSkipConnect,
    isDemoMode,
    isThreadClosed,
    openMessagesConversation,
    token,
  ]);

  // ────────────────────────────────────────────────────────────
  // Header (hero confession)
  // ────────────────────────────────────────────────────────────
  const renderHeader = useCallback(() => {
    if (!confession) return null;

    const effectiveVisibility =
      confession.authorVisibility || (confession.isAnonymous ? 'anonymous' : 'open');
    const isFullyAnonymous = effectiveVisibility === 'anonymous';
    const isBlurPhoto =
      effectiveVisibility === 'blur_photo' || (effectiveVisibility as string) === 'blur';
    const viewerIdCandidates = [
      currentUserId,
      !isDemoMode ? String((convexCurrentUser as any)?._id ?? '') : undefined,
    ].filter((candidate): candidate is string => Boolean(candidate));
    const taggedUserName = confession.taggedUserName?.trim();
    const isTaggedViewer = Boolean(
      confession.taggedUserId &&
      viewerIdCandidates.includes(String(confession.taggedUserId))
    );
    const taggedDisplayName = taggedUserName
      ? (isTaggedViewer ? 'You' : taggedUserName)
      : null;

    const getDisplayName = (): string => {
      if (isFullyAnonymous) return 'Anonymous';
      if (!confession.authorName) return 'Someone';
      let name = confession.authorName;
      if (confession.authorAge) name += `, ${confession.authorAge}`;
      return name;
    };

    return (
      <View style={styles.headerSection}>
        <Pressable
          style={styles.confessionCard}
          onLongPress={handleOpenConfessionMenu}
          delayLongPress={300}
          accessibilityRole="button"
          accessibilityLabel="Long-press for confession options"
        >
          <View style={styles.authorRow}>
            <View style={styles.authorIdentityCluster}>
              {isFullyAnonymous ? (
                <View style={[styles.avatar, styles.avatarAnonymous]}>
                  <Ionicons name="eye-off" size={12} color={COLORS.textMuted} />
                </View>
              ) : isBlurPhoto && confession.authorPhotoUrl ? (
                <Image
                  source={{ uri: confession.authorPhotoUrl }}
                  style={styles.avatarImage}
                  contentFit="cover"
                  blurRadius={CONFESSION_BLUR_PHOTO_RADIUS}
                />
              ) : confession.authorPhotoUrl ? (
                <Image
                  source={{ uri: confession.authorPhotoUrl }}
                  style={styles.avatarImage}
                  contentFit="cover"
                />
              ) : (
                <View style={styles.avatar}>
                  <Ionicons name="person" size={12} color={COLORS.primary} />
                </View>
              )}
              <View style={styles.authorIdentityText}>
                <Text
                  maxFontSizeMultiplier={1.2}
                  style={[styles.authorName, !isFullyAnonymous && styles.authorNamePublic]}
                  numberOfLines={1}
                >
                  {getDisplayName()}
                </Text>
                {!isFullyAnonymous ? <GenderSymbol gender={confession.authorGender} /> : null}
              </View>
            </View>
            <Text maxFontSizeMultiplier={1.2} style={styles.timeAgo}>{formatTimeAgo(confession.createdAt)}</Text>
          </View>

          <Text maxFontSizeMultiplier={1.2} style={styles.confessionText}>{confession.text}</Text>

          {/* Tagged user chip — opens the tagged user's profile via a
              server-validated one-tap grant. Hidden when the confession is
              fully anonymous (serializer never exposes the tag in that case). */}
          {confession.taggedUserId && taggedDisplayName ? (
            <TouchableOpacity
              style={styles.taggedRow}
              onPress={() => void handleTagPress(confession._id, confession.taggedUserId)}
              activeOpacity={0.7}
            >
              <Ionicons name="heart" size={14} color={COLORS.primary} />
              <Text maxFontSizeMultiplier={1.2} style={styles.taggedLabel}>Confess-to:</Text>
              <Text
                maxFontSizeMultiplier={1.2}
                style={styles.taggedName}
                numberOfLines={1}
              >
                {taggedDisplayName}
              </Text>
            </TouchableOpacity>
          ) : null}

          <View style={styles.statsRow}>
            <View style={styles.statItem}>
              <Ionicons name="chatbubble-outline" size={14} color={COLORS.textMuted} />
              <Text maxFontSizeMultiplier={1.2} style={styles.statCount}>{confession.replyCount}</Text>
              <Text maxFontSizeMultiplier={1.2} style={styles.statLabel}>
                {confession.replyCount === 1 ? 'Reply' : 'Replies'}
              </Text>
            </View>
            <View style={styles.statItem}>
              <Ionicons name="heart-outline" size={14} color={COLORS.textMuted} />
              <Text maxFontSizeMultiplier={1.2} style={styles.statCount}>{confession.reactionCount}</Text>
              <Text maxFontSizeMultiplier={1.2} style={styles.statLabel}>
                {confession.reactionCount === 1 ? 'Reaction' : 'Reactions'}
              </Text>
            </View>
          </View>
        </Pressable>

        {isThreadClosed ? (
          <View style={styles.closedBanner}>
            <Ionicons name="time-outline" size={14} color={COLORS.textMuted} />
            <Text maxFontSizeMultiplier={1.2} style={styles.closedBannerText}>
              {closedThreadMessage}
            </Text>
          </View>
        ) : null}

        {renderConnectPanel()}

        {topLevelReplies.length > 0 ? (
          <View style={styles.repliesSectionHeader}>
            <Text maxFontSizeMultiplier={1.2} style={styles.repliesSectionTitle}>
              {topLevelReplies.length}{' '}
              {topLevelReplies.length === 1 ? 'Reply' : 'Replies'}
            </Text>
          </View>
        ) : null}
      </View>
    );
  }, [closedThreadMessage, confession, convexCurrentUser, currentUserId, handleOpenConfessionMenu, handleTagPress, isDemoMode, isThreadClosed, renderConnectPanel, topLevelReplies.length]);

  const renderEmpty = useCallback(() => {
    if (isLoading) return null;
    return (
      <View style={styles.emptyContainer}>
        <View style={styles.emptyIconWrap}>
          <Ionicons name="chatbubbles-outline" size={40} color={COLORS.textMuted} />
        </View>
        <Text maxFontSizeMultiplier={1.2} style={styles.emptyTitle}>
          {isThreadClosed ? 'Thread closed' : 'No replies yet'}
        </Text>
        <Text maxFontSizeMultiplier={1.2} style={styles.emptySubtitle}>
          {isThreadClosed
            ? closedThreadMessage
            : 'Be the first to share your thoughts'}
        </Text>
      </View>
    );
  }, [closedThreadMessage, isLoading, isThreadClosed]);

  const renderRepliesLimitFooter = useCallback(() => {
    if (!repliesHasMore) return null;
    return (
      <View style={styles.repliesLimitNotice}>
        <Ionicons name="chatbubble-ellipses-outline" size={14} color={COLORS.textMuted} />
        <Text maxFontSizeMultiplier={1.2} style={styles.repliesLimitText}>
          Showing the first {CONFESSION_REPLY_PAGE_LIMIT} replies.
        </Text>
      </View>
    );
  }, [repliesHasMore]);

  // ────────────────────────────────────────────────────────────
  // Loading / not-found states
  // ────────────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.header}>
          <TouchableOpacity onPress={handleBack} hitSlop={8}>
            <Ionicons name="chevron-back" size={24} color={COLORS.text} />
          </TouchableOpacity>
          <Text maxFontSizeMultiplier={1.2} style={styles.headerTitle}>Thread</Text>
          <View style={{ width: 24 }} />
        </View>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={COLORS.primary} />
          <Text maxFontSizeMultiplier={1.2} style={styles.loadingText}>Loading thread...</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (!confession) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.header}>
          <TouchableOpacity onPress={handleBack} hitSlop={8}>
            <Ionicons name="chevron-back" size={24} color={COLORS.text} />
          </TouchableOpacity>
          <Text maxFontSizeMultiplier={1.2} style={styles.headerTitle}>Thread</Text>
          <View style={{ width: 24 }} />
        </View>
        <View style={styles.errorContainer}>
          <View style={styles.errorIconWrap}>
            <Ionicons name="alert-circle-outline" size={48} color={COLORS.textMuted} />
          </View>
          <Text maxFontSizeMultiplier={1.2} style={styles.errorTitle}>
            This confession is no longer available.
          </Text>
          <Text maxFontSizeMultiplier={1.2} style={styles.errorSubtitle}>
            It may have expired, been deleted, or become unavailable.
          </Text>
          <TouchableOpacity style={styles.errorButton} onPress={handleBack}>
            <Text maxFontSizeMultiplier={1.2} style={styles.errorButtonText}>Go Back</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  // ────────────────────────────────────────────────────────────
  // Composer sub-sections
  // ────────────────────────────────────────────────────────────
  const renderIdentitySelector = () => (
    <View style={styles.identitySelectorRow}>
      {IDENTITY_OPTIONS.map((opt) => {
        const selected = identityMode === opt.key;
        return (
          <TouchableOpacity
            key={opt.key}
            style={[styles.identityChip, selected && styles.identityChipSelected]}
            onPress={() => setIdentityMode(opt.key)}
            activeOpacity={0.8}
          >
            <Ionicons
              name={opt.icon}
              size={14}
              color={selected ? COLORS.white : COLORS.textLight}
            />
            <Text
              style={[styles.identityChipLabel, selected && styles.identityChipLabelSelected]}
              numberOfLines={1}
            >
              {opt.label}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );

  const renderActiveComposer = () => {
    const description =
      IDENTITY_OPTIONS.find((o) => o.key === identityMode)?.description ?? '';

    let placeholder = 'Write a comment...';
    if (composerMode === 'edit') placeholder = 'Edit your comment...';
    else if (composerMode === 'owner-reply') placeholder = 'Reply as the author...';
    else if (identityMode === 'anonymous') placeholder = 'Comment anonymously...';

    return (
      <View style={[styles.composerContainer, { paddingBottom: Math.max(insets.bottom, 12) }]}>
        {composerMode === 'owner-reply' && replyingToParent ? (
          <View style={styles.replyingToBar}>
            <Ionicons name="return-down-forward-outline" size={13} color={COLORS.textMuted} />
            <Text maxFontSizeMultiplier={1.2} style={styles.replyingToText} numberOfLines={1}>
              Replying to{' '}
              {canonicalMode(
                replyingToParent.identityMode as string | undefined,
                !!replyingToParent.isAnonymous
              ) === 'anonymous'
                ? 'Anonymous'
                : replyingToParent.authorName ?? 'Someone'}
            </Text>
            <TouchableOpacity onPress={resetComposer} hitSlop={8}>
              <Ionicons name="close" size={14} color={COLORS.textMuted} />
            </TouchableOpacity>
          </View>
        ) : null}

        {composerMode === 'edit' ? (
          <View style={styles.replyingToBar}>
            <Ionicons name="create-outline" size={13} color={COLORS.textMuted} />
            <Text maxFontSizeMultiplier={1.2} style={styles.replyingToText} numberOfLines={1}>
              Editing your comment
            </Text>
            <TouchableOpacity onPress={resetComposer} hitSlop={8}>
              <Ionicons name="close" size={14} color={COLORS.textMuted} />
            </TouchableOpacity>
          </View>
        ) : null}

        {composerMode !== 'owner-reply' ? renderIdentitySelector() : null}

        <View style={styles.composerRow}>
          <TextInput
            ref={inputRef}
            style={styles.textInput}
            placeholder={placeholder}
            placeholderTextColor={COLORS.textMuted}
            value={replyText}
            onChangeText={setReplyText}
            multiline
            maxLength={500}
          />
          <TouchableOpacity
            style={[
              styles.sendButton,
              (!replyText.trim() || submitting) && styles.sendButtonDisabled,
            ]}
            onPress={handleSubmitReply}
            disabled={!replyText.trim() || submitting}
            activeOpacity={0.8}
          >
            {submitting ? (
              <ActivityIndicator size="small" color={COLORS.white} />
            ) : (
              <Ionicons
                name={composerMode === 'edit' ? 'checkmark' : 'arrow-up'}
                size={18}
                color={COLORS.white}
              />
            )}
          </TouchableOpacity>
        </View>

        <Text maxFontSizeMultiplier={1.2} style={styles.composerHint}>{description}</Text>
      </View>
    );
  };

  const renderAlreadyCommentedFooter = () => {
    if (!myExistingReply) return null;
    return (
      <View
        style={[
          styles.alreadyCommentedContainer,
          { paddingBottom: Math.max(insets.bottom, 8) },
        ]}
      >
        <View style={styles.alreadyCommentedRow}>
          <View style={styles.alreadyCommentedIcon}>
            <Ionicons name="checkmark-circle-outline" size={18} color={COLORS.primary} />
          </View>
          <View style={{ flex: 1 }}>
            <Text maxFontSizeMultiplier={1.2} style={styles.alreadyCommentedTitle}>You already commented</Text>
            <Text maxFontSizeMultiplier={1.2} style={styles.alreadyCommentedSub} numberOfLines={1}>
              Long-press your comment to edit or delete
            </Text>
          </View>
        </View>
      </View>
    );
  };

  const renderClosedFooter = () => (
    <View style={[styles.ownerNotice, { paddingBottom: Math.max(insets.bottom, 16) }]}>
      <View style={styles.ownerNoticeInner}>
        <View style={styles.ownerNoticeIcon}>
          <Ionicons name="time-outline" size={14} color={COLORS.textMuted} />
        </View>
        <Text maxFontSizeMultiplier={1.2} style={styles.ownerNoticeText}>
          {closedThreadMessage}
        </Text>
      </View>
    </View>
  );

  const renderOwnerIdleFooter = () => (
    <View style={[styles.ownerNotice, { paddingBottom: Math.max(insets.bottom, 16) }]}>
      <View style={styles.ownerNoticeInner}>
        <View style={styles.ownerNoticeIcon}>
          <Ionicons name="eye-outline" size={14} color={COLORS.textMuted} />
        </View>
        <Text maxFontSizeMultiplier={1.2} style={styles.ownerNoticeText}>
          This is your confession. Tap Reply on any comment to respond as the author.
        </Text>
      </View>
    </View>
  );

  // ────────────────────────────────────────────────────────────
  // Footer selector — choose which composer (or closed notice) to show
  // ────────────────────────────────────────────────────────────
  let footer: React.ReactNode;
  if (isThreadClosed) {
    footer = renderClosedFooter();
  } else if (composerMode === 'edit') {
    // Edit must beat the isOwner branch so owners editing their own inline
    // replies still see the edit composer (otherwise the idle-owner notice
    // swallows it and there is no way to save the edit).
    footer = renderActiveComposer();
  } else if (isOwner) {
    footer = composerMode === 'owner-reply' ? renderActiveComposer() : renderOwnerIdleFooter();
  } else if (myExistingReply) {
    footer = renderAlreadyCommentedFooter();
  } else {
    footer = renderActiveComposer();
  }

  const confessionMenuVisibility =
    confession.authorVisibility || (confession.isAnonymous ? 'anonymous' : 'open');
  const confessionMenuDisplayName =
    !isOwner && confessionMenuVisibility === 'open'
      ? confession.authorName
      : undefined;

  // ────────────────────────────────────────────────────────────
  // Main render
  // ────────────────────────────────────────────────────────────
  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.keyboardContainer}
        keyboardVerticalOffset={0}
      >
        <View style={styles.header}>
          <TouchableOpacity onPress={handleBack} hitSlop={8}>
            <Ionicons name="chevron-back" size={24} color={COLORS.text} />
          </TouchableOpacity>
          <Text maxFontSizeMultiplier={1.2} style={styles.headerTitle}>Thread</Text>
          <View style={{ width: 24 }} />
        </View>

        <FlatList
          data={topLevelReplies}
          keyExtractor={(item) => item._id}
          renderItem={renderReplyItem}
          ListHeaderComponent={renderHeader}
          ListEmptyComponent={renderEmpty}
          ListFooterComponent={renderRepliesLimitFooter}
          contentContainerStyle={[
            styles.listContent,
            { paddingBottom: insets.bottom + 96 },
          ]}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={handleRefresh}
              tintColor={COLORS.primary}
              colors={[COLORS.primary]}
            />
          }
        />

        {footer}
      </KeyboardAvoidingView>

      {/* Long-press action modal for own comment — compact centered card */}
      <Modal
        visible={menuVisible}
        transparent
        animationType="none"
        onRequestClose={() => setMenuReplyId(null)}
      >
        <Animated.View style={[styles.menuBackdrop, { opacity: menuOpacity }]}>
          <Pressable style={styles.menuBackdropPress} onPress={() => setMenuReplyId(null)}>
            <Animated.View
              style={[
                styles.menuCard,
                { opacity: menuOpacity, transform: [{ scale: menuScale }] },
              ]}
              // Stop touches on the card from closing the modal.
              onStartShouldSetResponder={() => true}
            >
              <Text maxFontSizeMultiplier={1.2} style={styles.menuTitle}>
                {menuTargetIsOwn ? 'Manage Comment' : 'Comment Actions'}
              </Text>

              {menuTargetIsOwn ? (
                <View style={styles.menuRow}>
                  <TouchableOpacity
                    style={[styles.menuBtn, styles.menuBtnEdit]}
                    onPress={handleBeginEdit}
                    activeOpacity={0.85}
                  >
                    <Ionicons name="create-outline" size={18} color={COLORS.primary} />
                    <Text maxFontSizeMultiplier={1.2} style={[styles.menuBtnText, styles.menuBtnTextEdit]}>Edit</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[styles.menuBtn, styles.menuBtnDelete]}
                    onPress={handleDelete}
                    activeOpacity={0.85}
                  >
                    <Ionicons name="trash-outline" size={18} color={MENU_DANGER} />
                    <Text maxFontSizeMultiplier={1.2} style={[styles.menuBtnText, styles.menuBtnTextDelete]}>Delete</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[styles.menuBtn, styles.menuBtnCancel]}
                    onPress={() => setMenuReplyId(null)}
                    activeOpacity={0.85}
                  >
                    <Ionicons name="close-outline" size={18} color={COLORS.textMuted} />
                    <Text maxFontSizeMultiplier={1.2} style={[styles.menuBtnText, styles.menuBtnTextCancel]}>Cancel</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <View style={styles.menuRow}>
                  <TouchableOpacity
                    style={[styles.menuBtn, styles.menuBtnReport]}
                    onPress={handleReport}
                    activeOpacity={0.85}
                  >
                    <Ionicons name="flag-outline" size={18} color={MENU_DANGER} />
                    <Text maxFontSizeMultiplier={1.2} style={[styles.menuBtnText, styles.menuBtnTextReport]}>Report</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[styles.menuBtn, styles.menuBtnCancel]}
                    onPress={() => setMenuReplyId(null)}
                    activeOpacity={0.85}
                  >
                    <Ionicons name="close-outline" size={18} color={COLORS.textMuted} />
                    <Text maxFontSizeMultiplier={1.2} style={[styles.menuBtnText, styles.menuBtnTextCancel]}>Cancel</Text>
                  </TouchableOpacity>
                </View>
              )}
            </Animated.View>
          </Pressable>
        </Animated.View>
      </Modal>

      <ReportConfessionSheet
        visible={reportingReplyId !== null}
        mode="reply"
        onClose={() => setReportingReplyId(null)}
        onSubmit={handleSubmitReplyReport}
      />

      {/* Hero-confession menu (Edit/Delete owner, Report non-owner) */}
      <ConfessionMenuSheet
        visible={showConfessionMenu}
        isOwner={!!confession && confession.userId === currentUserId}
        onClose={handleCloseConfessionMenu}
        onEdit={handleConfessionMenuEdit}
        onDelete={handleConfessionMenuDelete}
        onReport={handleConfessionMenuReport}
        displayName={confessionMenuDisplayName}
        displayNameKey={String(confession._id)}
      />

      <ReportConfessionSheet
        visible={reportingMainConfessionId !== null}
        mode="confession"
        onClose={() => setReportingMainConfessionId(null)}
        onSubmit={handleSubmitMainConfessionReport}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  // ─────────────────────────────────────────────────────────────
  // Container & Layout - matches homepage
  // ─────────────────────────────────────────────────────────────
  container: {
    flex: 1,
    backgroundColor: COLORS.backgroundDark,
  },
  keyboardContainer: {
    flex: 1,
  },
  listContent: {
    paddingTop: SPACING.sm,
  },

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.border,
    backgroundColor: COLORS.backgroundDark,
  },
  headerTitle: {
    fontSize: moderateScale(15, 0.4),
    fontWeight: '700',
    color: COLORS.text,
  },

  // Loading
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: SPACING.md,
  },
  loadingText: {
    fontSize: FONT_SIZE.lg,
    color: COLORS.textLight,
  },

  // Error
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: moderateScale(32, 0.5),
  },
  errorIconWrap: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: 'rgba(153,153,153,0.1)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: SPACING.base,
  },
  errorTitle: {
    fontSize: moderateScale(22, 0.4),
    fontWeight: '700',
    color: COLORS.text,
    marginBottom: SPACING.sm,
  },
  errorSubtitle: {
    fontSize: moderateScale(15, 0.4),
    lineHeight: lineHeight(moderateScale(15, 0.4), 1.35),
    color: COLORS.textLight,
    textAlign: 'center',
    marginBottom: SPACING.xl,
  },
  errorButton: {
    borderRadius: 24,
    paddingHorizontal: SPACING.xl,
    paddingVertical: SPACING.md,
    backgroundColor: COLORS.primary,
  },
  errorButtonText: {
    fontSize: moderateScale(15, 0.4),
    fontWeight: '600',
    color: COLORS.white,
  },

  // Header section
  headerSection: {
    paddingBottom: SPACING.xs,
  },

  // Confession card (hero)
  confessionCard: {
    backgroundColor: COLORS.background,
    borderRadius: 16,
    paddingHorizontal: SPACING.base,
    paddingTop: SPACING.md,
    paddingBottom: SPACING.md,
    marginHorizontal: SPACING.md,
    marginVertical: SPACING.xs,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 3,
  },
  authorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    marginBottom: SPACING.sm,
    minHeight: 26,
  },
  authorIdentityCluster: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
  },
  authorIdentityText: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
  },
  avatar: {
    width: AVATAR_SIZE,
    height: AVATAR_SIZE,
    borderRadius: AVATAR_SIZE / 2,
    backgroundColor: 'rgba(255,107,107,0.12)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarImage: {
    width: AVATAR_SIZE,
    height: AVATAR_SIZE,
    borderRadius: AVATAR_SIZE / 2,
  },
  avatarAnonymous: {
    backgroundColor: 'rgba(153,153,153,0.12)',
  },
  authorName: {
    fontSize: FONT_SIZE.body2,
    fontWeight: '600',
    color: COLORS.textLight,
    flexShrink: 1,
    minWidth: 0,
  },
  // Public (open / blur_photo) name uses the premium readable text color.
  // Identity color (pink/blue) is reserved for the gender symbol only.
  // The hero name string is `name, age` so this color rules both name + age.
  authorNamePublic: {
    color: COLORS.text,
  },
  timeAgo: {
    fontSize: FONT_SIZE.caption,
    color: COLORS.textMuted,
    flexShrink: 0,
  },
  confessionText: {
    fontSize: FONT_SIZE.lg,
    fontWeight: '500',
    lineHeight: lineHeight(FONT_SIZE.lg, 1.35),
    color: COLORS.text,
    marginBottom: SPACING.md,
    letterSpacing: 0.1,
  },
  taggedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.xs,
    paddingVertical: SPACING.xs,
    marginBottom: SPACING.sm,
  },
  taggedLabel: {
    fontSize: FONT_SIZE.body2,
    color: COLORS.textMuted,
    fontWeight: '500',
  },
  taggedName: {
    fontSize: FONT_SIZE.body2,
    color: COLORS.primary,
    fontWeight: '600',
    flexShrink: 1,
  },
  statsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.base,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
    paddingTop: SPACING.md,
    marginTop: SPACING.xs,
  },
  statItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.xs,
  },
  statCount: {
    fontSize: FONT_SIZE.body2,
    color: COLORS.textMuted,
    fontWeight: '500',
  },
  statLabel: {
    fontSize: FONT_SIZE.body2,
    color: COLORS.textMuted,
  },

  // Closed banner
  closedBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    marginHorizontal: SPACING.md,
    marginTop: SPACING.xs,
    marginBottom: SPACING.xs,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    backgroundColor: 'rgba(153,153,153,0.10)',
    borderRadius: 12,
  },
  closedBannerText: {
    fontSize: FONT_SIZE.caption,
    color: COLORS.textLight,
    flex: 1,
  },
  connectPanel: {
    marginHorizontal: SPACING.md,
    marginTop: SPACING.xs,
    marginBottom: SPACING.xs,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    borderRadius: 14,
    backgroundColor: COLORS.background,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: COLORS.border,
    gap: SPACING.sm,
  },
  connectPanelSuccess: {
    backgroundColor: 'rgba(52,199,89,0.08)',
    borderColor: 'rgba(52,199,89,0.22)',
  },
  connectPanelHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.xs,
  },
  connectPanelTitle: {
    fontSize: FONT_SIZE.body2,
    fontWeight: '700',
    color: COLORS.text,
  },
  connectPanelText: {
    fontSize: FONT_SIZE.caption,
    lineHeight: lineHeight(FONT_SIZE.caption, 1.35),
    color: COLORS.textLight,
  },
  connectButtonRow: {
    flexDirection: 'row',
    gap: SPACING.sm,
  },
  connectPrimaryButton: {
    flex: 1,
    minHeight: 40,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACING.xs,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    borderRadius: 12,
    backgroundColor: COLORS.primary,
  },
  connectSecondaryButton: {
    flex: 1,
    minHeight: 40,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACING.xs,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    borderRadius: 12,
    backgroundColor: COLORS.backgroundDark,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: COLORS.border,
  },
  connectButtonDisabled: {
    opacity: 0.55,
  },
  connectPrimaryButtonText: {
    fontSize: FONT_SIZE.caption,
    fontWeight: '700',
    color: COLORS.white,
  },
  connectSecondaryButtonText: {
    fontSize: FONT_SIZE.caption,
    fontWeight: '700',
    color: COLORS.text,
  },

  // Replies section header
  repliesSectionHeader: {
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.md,
  },
  repliesSectionTitle: {
    fontSize: FONT_SIZE.body2,
    fontWeight: '600',
    color: COLORS.textLight,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },

  // Reply cards
  replyCard: {
    backgroundColor: COLORS.background,
    borderRadius: 16,
    paddingHorizontal: SPACING.base,
    paddingTop: SPACING.md,
    paddingBottom: SPACING.md,
    marginHorizontal: SPACING.md,
    marginBottom: SPACING.sm,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  replyCardOwn: {
    borderLeftWidth: 3,
    borderLeftColor: COLORS.primary,
  },
  replyCardPressed: {
    opacity: 0.85,
  },
  replyHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    marginBottom: SPACING.sm,
  },
  replyAvatar: {
    width: REPLY_AVATAR_SIZE,
    height: REPLY_AVATAR_SIZE,
    borderRadius: REPLY_AVATAR_SIZE / 2,
    backgroundColor: 'rgba(255,107,107,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  replyAvatarAnon: {
    backgroundColor: 'rgba(153,153,153,0.12)',
  },
  replyAvatarImage: {
    width: REPLY_AVATAR_SIZE,
    height: REPLY_AVATAR_SIZE,
    borderRadius: REPLY_AVATAR_SIZE / 2,
  },
  replyAuthorBlock: {
    flex: 1,
  },
  replyAuthorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.xs,
  },
  replyAuthor: {
    fontSize: FONT_SIZE.body2,
    fontWeight: '600',
    color: COLORS.text,
  },
  replyAuthorOwn: {
    color: COLORS.primary,
  },
  replyAuthorAnon: {
    color: COLORS.textLight,
  },
  replyYouTag: {
    fontSize: FONT_SIZE.caption,
    color: COLORS.textMuted,
    fontWeight: '500',
  },
  genderIcon: {
    marginLeft: SPACING.xxs,
  },
  replyTime: {
    fontSize: FONT_SIZE.sm,
    color: COLORS.textMuted,
    marginTop: SPACING.xxs,
  },
  replyText: {
    fontSize: moderateScale(15, 0.4),
    lineHeight: lineHeight(moderateScale(15, 0.4), 1.35),
    color: COLORS.text,
    paddingLeft: REPLY_AVATAR_SIZE + 8,
  },
  // Header-right compact Reply button (inline with name/time).
  headerReplyBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.xxs,
    paddingVertical: SPACING.xs,
    paddingHorizontal: SPACING.sm,
    backgroundColor: 'rgba(255,107,107,0.10)',
    borderRadius: 10,
  },
  headerReplyBtnText: {
    fontSize: FONT_SIZE.sm,
    fontWeight: '600',
    color: COLORS.primary,
    letterSpacing: 0.1,
  },

  // Inline owner reply — rendered INSIDE the parent comment card.
  inlineReplyGroup: {
    marginTop: SPACING.sm,
    marginLeft: REPLY_AVATAR_SIZE + 8,
    paddingTop: SPACING.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: COLORS.border,
  },
  inlineReplyRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: SPACING.sm,
    paddingVertical: SPACING.xxs,
  },
  inlineReplyConnector: {
    width: 2,
    backgroundColor: 'rgba(255,107,107,0.35)',
    borderRadius: 1,
    marginTop: SPACING.xs,
    marginBottom: SPACING.xs,
  },
  inlineReplyContent: {
    flex: 1,
  },
  inlineReplyHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.xs,
    marginBottom: SPACING.xs,
    flexWrap: 'wrap',
  },
  inlineReplyAuthor: {
    fontSize: FONT_SIZE.caption,
    fontWeight: '600',
    color: COLORS.text,
  },
  inlineAuthorBadge: {
    paddingHorizontal: SPACING.xs,
    paddingVertical: SPACING.xxs,
    backgroundColor: 'rgba(255,107,107,0.14)',
    borderRadius: 6,
  },
  inlineAuthorBadgeText: {
    fontSize: FONT_SIZE.xxs,
    fontWeight: '700',
    color: COLORS.primary,
    letterSpacing: 0.3,
    textTransform: 'uppercase',
  },
  inlineReplyTime: {
    fontSize: FONT_SIZE.xs,
    color: COLORS.textMuted,
    marginLeft: 'auto',
  },
  inlineReplyText: {
    fontSize: FONT_SIZE.body2,
    lineHeight: lineHeight(FONT_SIZE.body2, 1.35),
    color: COLORS.text,
    paddingLeft: REPLY_AVATAR_SIZE + 6,
  },

  // Empty state
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: moderateScale(32, 0.5),
    paddingTop: SPACING.xxxl,
  },
  emptyIconWrap: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: 'rgba(153,153,153,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: SPACING.base,
  },
  emptyTitle: {
    fontSize: FONT_SIZE.xl,
    fontWeight: '700',
    color: COLORS.text,
    marginBottom: SPACING.sm,
  },
  emptySubtitle: {
    fontSize: moderateScale(15, 0.4),
    lineHeight: lineHeight(moderateScale(15, 0.4), 1.35),
    color: COLORS.textLight,
    textAlign: 'center',
  },
  repliesLimitNotice: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACING.xs,
    paddingTop: SPACING.md,
    paddingHorizontal: SPACING.md,
  },
  repliesLimitText: {
    fontSize: FONT_SIZE.caption,
    color: COLORS.textMuted,
    lineHeight: lineHeight(FONT_SIZE.caption, 1.25),
  },

  // Owner notice
  ownerNotice: {
    backgroundColor: COLORS.background,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: COLORS.border,
    paddingHorizontal: SPACING.md,
    paddingTop: SPACING.md,
  },
  ownerNoticeInner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(153,153,153,0.08)',
    borderRadius: 12,
    padding: SPACING.md,
    gap: SPACING.sm,
  },
  ownerNoticeIcon: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: COLORS.background,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ownerNoticeText: {
    flex: 1,
    fontSize: FONT_SIZE.body2,
    color: COLORS.textLight,
    lineHeight: lineHeight(FONT_SIZE.body2, 1.35),
  },

  // Composer
  composerContainer: {
    backgroundColor: COLORS.background,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: COLORS.border,
    paddingHorizontal: SPACING.md,
    paddingTop: SPACING.sm,
  },
  replyingToBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.xs,
    marginBottom: SPACING.sm,
    paddingHorizontal: SPACING.sm,
    paddingVertical: SPACING.xs,
    backgroundColor: 'rgba(153,153,153,0.10)',
    borderRadius: 10,
  },
  replyingToText: {
    flex: 1,
    fontSize: FONT_SIZE.caption,
    color: COLORS.textLight,
  },
  identitySelectorRow: {
    flexDirection: 'row',
    gap: SPACING.xs,
    marginBottom: SPACING.sm,
  },
  identityChip: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACING.xs,
    paddingVertical: SPACING.sm,
    paddingHorizontal: SPACING.sm,
    borderRadius: 14,
    backgroundColor: COLORS.backgroundDark,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  identityChipSelected: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },
  identityChipLabel: {
    fontSize: FONT_SIZE.caption,
    fontWeight: '600',
    color: COLORS.textLight,
  },
  identityChipLabelSelected: {
    color: COLORS.white,
  },
  composerRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: SPACING.sm,
  },
  textInput: {
    flex: 1,
    backgroundColor: COLORS.backgroundDark,
    borderRadius: 20,
    paddingHorizontal: SPACING.base,
    paddingVertical: SPACING.sm,
    fontSize: FONT_SIZE.md,
    color: COLORS.text,
    maxHeight: 100,
  },
  sendButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: COLORS.primary,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: COLORS.primary,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 2,
  },
  sendButtonDisabled: {
    backgroundColor: COLORS.border,
    shadowOpacity: 0,
    elevation: 0,
  },
  composerHint: {
    fontSize: FONT_SIZE.sm,
    color: COLORS.textMuted,
    marginTop: SPACING.xs,
    marginBottom: SPACING.xxs,
    textAlign: 'center',
  },

  // Already-commented footer — compact; distinct from the full composer.
  alreadyCommentedContainer: {
    backgroundColor: COLORS.background,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: COLORS.border,
    paddingHorizontal: SPACING.md,
    paddingTop: SPACING.xs,
  },
  alreadyCommentedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    paddingVertical: SPACING.sm,
    paddingHorizontal: SPACING.sm,
    backgroundColor: 'rgba(255,107,107,0.08)',
    borderRadius: 12,
  },
  alreadyCommentedIcon: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: COLORS.background,
    alignItems: 'center',
    justifyContent: 'center',
  },
  alreadyCommentedTitle: {
    fontSize: FONT_SIZE.body2,
    fontWeight: '700',
    color: COLORS.text,
  },
  alreadyCommentedSub: {
    fontSize: FONT_SIZE.sm,
    color: COLORS.textMuted,
    marginTop: SPACING.xxs,
  },
  // Long-press compact action modal (centered card)
  menuBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  menuBackdropPress: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: SPACING.xxl,
  },
  menuCard: {
    width: '100%',
    maxWidth: 340,
    backgroundColor: COLORS.background,
    borderRadius: 20,
    paddingTop: SPACING.base,
    paddingHorizontal: SPACING.base,
    paddingBottom: SPACING.base,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: COLORS.border,
    shadowColor: '#000',
    shadowOpacity: 0.28,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 12 },
    elevation: 16,
  },
  menuTitle: {
    fontSize: moderateScale(15, 0.4),
    fontWeight: '700',
    color: COLORS.text,
    textAlign: 'center',
    marginBottom: SPACING.base,
    letterSpacing: 0.2,
  },
  menuRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: SPACING.sm,
  },
  menuBtn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACING.xs,
    paddingVertical: SPACING.md,
    paddingHorizontal: SPACING.xs,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
  },
  menuBtnEdit: {
    backgroundColor: 'rgba(255, 107, 107, 0.10)',
    borderColor: 'rgba(255, 107, 107, 0.28)',
  },
  menuBtnDelete: {
    backgroundColor: 'rgba(220, 38, 38, 0.08)',
    borderColor: 'rgba(220, 38, 38, 0.25)',
  },
  menuBtnReport: {
    flex: 2,
    backgroundColor: 'rgba(220, 38, 38, 0.08)',
    borderColor: 'rgba(220, 38, 38, 0.25)',
  },
  menuBtnCancel: {
    backgroundColor: COLORS.backgroundDark,
    borderColor: COLORS.border,
  },
  menuBtnText: {
    fontSize: FONT_SIZE.body2,
    fontWeight: '600',
    letterSpacing: 0.1,
  },
  menuBtnTextEdit: {
    color: COLORS.primary,
  },
  menuBtnTextDelete: {
    color: MENU_DANGER,
  },
  menuBtnTextReport: {
    color: MENU_DANGER,
  },
  menuBtnTextCancel: {
    color: COLORS.textMuted,
  },
});
