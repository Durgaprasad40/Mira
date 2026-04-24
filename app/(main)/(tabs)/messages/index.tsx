/*
 * LOCKED (PHASE-1 TAB)
 * Do NOT modify this file unless Durga Prasad explicitly unlocks it.
 * Nearby tab is the only Phase-1 tab currently unlocked.
 */
import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  RefreshControl,
  ActivityIndicator,
  Modal,
  Animated,
  Dimensions,
  BackHandler,
  TextInput,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams, useFocusEffect } from 'expo-router';
import { safePush } from '@/lib/safeRouter';
import { LoadingGuard } from '@/components/safety';
import { Image } from 'expo-image';
import { useQuery, useMutation, useConvex } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { useAuthStore } from '@/stores/authStore';
import { COLORS, FONT_SIZE, SPACING as UI_SPACING, SIZES, lineHeight, moderateScale } from '@/lib/constants';
import { ConversationItem } from '@/components/chat';
import { Ionicons } from '@expo/vector-icons';
import { isDemoMode } from '@/hooks/useConvex';
import { asUserId } from '@/convex/id';
import { getDemoCurrentUser, DEMO_PROFILES } from '@/lib/demoData';
import { useDemoStore } from '@/stores/demoStore';
import { useBlockStore } from '@/stores/blockStore';
import { useDemoDmStore } from '@/stores/demoDmStore';
import { useScreenSafety } from '@/hooks/useScreenSafety';
import { getProfileCompleteness, NUDGE_MESSAGES } from '@/lib/profileCompleteness';
import { ProfileNudge } from '@/components/ui/ProfileNudge';
import { Toast } from '@/components/ui/Toast';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import {
  processThreadsIntegrity,
  type ProcessedThread,
} from '@/lib/threadsIntegrity';
import { log } from '@/utils/logger';
import { useScreenTrace } from '@/lib/devTrace';
import { useBatchPresence, type PresenceStatus } from '@/hooks/usePresence';
import type { Id } from '@/convex/_generated/dataModel';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const CARD_WIDTH = (SCREEN_WIDTH - UI_SPACING.base * 3) / 2;
const TEXT_MAX_SCALE = 1.2;
const TEXT_PROPS = { maxFontSizeMultiplier: TEXT_MAX_SCALE } as const;
const SECTION_SPACING = {
  sectionTop: UI_SPACING.sm,
  titleToRow: moderateScale(6, 0.25),
  sectionGap: UI_SPACING.sm,
  avatarSize: SIZES.avatar.lg,
  avatarGap: UI_SPACING.md,
} as const;
const TITLE_FONT_SIZE = FONT_SIZE.h2;
const LIKE_CARD_NAME_SIZE = moderateScale(15, 0.4);
const PREVIEW_TEXT_SIZE = moderateScale(15, 0.4);
const MODAL_TITLE_SIZE = FONT_SIZE.h1;
const MODAL_BODY_SIZE = FONT_SIZE.lg;
const MATCH_MODAL_ICON_SIZE = moderateScale(56, 0.3);
const EMPTY_STATE_ICON_SIZE = moderateScale(56, 0.3);
const HEADER_ICON_SIZE = SIZES.icon.lg;
const MINI_BADGE_ICON_SIZE = SIZES.icon.sm;
const COMPACT_BADGE_ICON_SIZE = SIZES.icon.xs;
const ACTION_ICON_SIZE = SIZES.icon.md;
const MATCH_MODAL_PHOTO_SIZE = moderateScale(96, 0.25);
const LIKES_BADGE_SIZE = moderateScale(18, 0.25);
const BADGE_HORIZONTAL_PADDING = UI_SPACING.xs;
const NEW_BADGE_VERTICAL_PADDING = moderateScale(3, 0.25);
const LIKE_CARD_CONTENT_PADDING = moderateScale(10, 0.25);

// Recency threshold: 24 hours
const RECENCY_THRESHOLD_MS = 24 * 60 * 60 * 1000;
const INBOX_TIMESTAMP_REFRESH_MS = 60 * 1000;
const INBOX_LOADING_PLACEHOLDER_COUNT = 4;

// Premium skeleton row with pulsing opacity (restored from c471732 inbox polish)
const SkeletonChatRow = React.memo(function SkeletonChatRow() {
  const pulseAnim = useRef(new Animated.Value(0.4)).current;
  useEffect(() => {
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 0.7, duration: 700, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 0.4, duration: 700, useNativeDriver: true }),
      ]),
    );
    pulse.start();
    return () => pulse.stop();
  }, [pulseAnim]);
  return (
    <Animated.View style={[styles.loadingConversationRow, { opacity: pulseAnim }]}>
      <View style={styles.loadingAvatar} />
      <View style={styles.loadingConversationBody}>
        <View style={styles.loadingConversationHeader}>
          <View style={styles.loadingNameBar} />
          <View style={styles.loadingTimeBar} />
        </View>
        <View style={styles.loadingPreviewBar} />
      </View>
    </Animated.View>
  );
});

// Format relative time
function formatRelativeTime(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp;
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days}d ago`;
  return new Date(timestamp).toLocaleDateString();
}

// Check if like is recent (within 24h)
function isRecentLike(createdAt: number): boolean {
  return Date.now() - createdAt < RECENCY_THRESHOLD_MS;
}

type InboxConversationRow = ProcessedThread | {
  id?: string | null;
  conversationId?: string | null;
  matchId?: string | null;
  otherUser?: {
    id?: string | null;
    name?: string;
    photoUrl?: string;
    lastActive?: number;
    isVerified?: boolean;
  } | null;
  lastMessage?: {
    content: string;
    type: string;
    senderId: string;
    createdAt: number;
    isProtected?: boolean;
  } | null;
  unreadCount?: number;
  isPreMatch?: boolean;
  /**
   * P1-RESTORE: Backend marks rows where the other side became unreachable
   * (match dissolved or user account deactivated). Frontend keeps the row
   * visible but degrades the avatar/name rendering gracefully.
   */
  terminalState?: 'unmatched' | 'user_removed' | null;
};

const SYSTEM_MARKER_RE = /^\[SYSTEM:(\w+)\]/;

function getConversationSearchPreview(
  lastMessage: {
    content: string;
    type: string;
    senderId: string;
    isProtected?: boolean;
  } | null | undefined,
  currentUserId?: string
): string {
  if (!lastMessage) return 'say hi';

  const previewPrefix = currentUserId && lastMessage.senderId === currentUserId ? 'you ' : '';
  if (lastMessage.isProtected) {
    return `${previewPrefix}${lastMessage.type === 'video' ? 'secure video' : 'secure photo'}`;
  }
  if (lastMessage.type === 'image') return `${previewPrefix}photo`;
  if (lastMessage.type === 'video') return `${previewPrefix}video`;
  if (lastMessage.type === 'voice') return `${previewPrefix}voice message`;
  if (lastMessage.type === 'dare') return `${previewPrefix}dare sent`;

  if (typeof lastMessage.content === 'string' && lastMessage.content.trim()) {
    const markerMatch = lastMessage.content.match(SYSTEM_MARKER_RE);
    if (markerMatch) {
      return lastMessage.content.slice(markerMatch[0].length).trim() || 'new message';
    }
    return `${previewPrefix}${lastMessage.content}`;
  }

  return 'new message';
}

function getNonEmptyString(value: string | null | undefined): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

function getConversationRouteId(item: InboxConversationRow): string | undefined {
  return getNonEmptyString(item.conversationId) ?? getNonEmptyString(item.id);
}

function getInboxMatchId(item: InboxConversationRow): string | undefined {
  return getNonEmptyString('matchId' in item ? item.matchId : undefined);
}

function getNormalizedInboxOtherUser(
  item: InboxConversationRow,
  presenceByUserId?: Record<string, { status: PresenceStatus }> | null,
) {
  if (!item.otherUser) return undefined;

  // P1-RESTORE: Preserve `id` even when it's empty/whitespace. Stripping it via
  // getNonEmptyString broke avatar rendering for demo-photo fallback rows whose
  // ConversationItem keys off the raw id field. Coerce null to undefined so the
  // ConversationItem prop type is satisfied without dropping non-empty strings.
  const otherUserId = item.otherUser.id ?? undefined;
  // P0-RESTORE: ConversationItem now reads `presenceStatus` (not `lastActive`)
  // for the green active-now dot. Inject status from the unified presence
  // batch so the dot lights up correctly.
  const presenceStatus =
    otherUserId && presenceByUserId ? presenceByUserId[otherUserId]?.status : undefined;
  return {
    ...item.otherUser,
    id: otherUserId,
    lastActive: item.otherUser.lastActive ?? 0,
    presenceStatus,
  };
}

function getInboxConversationKey(item: InboxConversationRow, index: number): string {
  const directId = getConversationRouteId(item);
  if (directId) return directId;

  const matchId = getInboxMatchId(item);
  if (matchId) return `match-${matchId}`;

  const otherUserId = getNonEmptyString(item.otherUser?.id);
  const lastMessageAt = typeof item.lastMessage?.createdAt === 'number'
    ? item.lastMessage.createdAt
    : undefined;

  if (otherUserId && lastMessageAt) {
    return `conversation-${otherUserId}-${lastMessageAt}`;
  }
  if (otherUserId) {
    return `conversation-${otherUserId}`;
  }

  return `conversation-fallback-${index}`;
}

export default function MessagesScreen() {
  useScreenTrace("MESSAGES");
  const router = useRouter();
  const { focus, profileId } = useLocalSearchParams<{
    focus?: string;
    profileId?: string;
  }>();

  const userId = useAuthStore((s) => s.userId);
  const token = useAuthStore((s) => s.token);
  const convexUserId = asUserId(userId);
  const convex = useConvex();
  const [refreshing, setRefreshing] = useState(false);
  const [inboxTimeReferenceMs, setInboxTimeReferenceMs] = useState(() => Date.now());

  // Swipe mutation for Convex mode like/pass actions
  const swipe = useMutation(api.likes.swipe);
  // P0-RESTORE: Lazy-create a conversation when the user taps a new-match card
  // that doesn't have a conversationId yet. Without this, taps silently fail.
  const ensureConversation = useMutation(api.conversations.getOrCreateForMatch);
  const [retryKey, setRetryKey] = useState(0);
  const { safeTimeout } = useScreenSafety();

  // View state: 'messages' | 'likes' — IN-PLACE toggle, not a route change
  const [activeView, setActiveView] = useState<'messages' | 'likes'>('messages');

  // P1-RESTORE: Search bar state for filtering conversations by name / preview text.
  // P1-POLISH: Debounce filter (120ms) so large inboxes don't lag per-keystroke,
  // but propagate empty/clear instantly so the UI snaps back without delay.
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState('');
  const clearSearch = useCallback(() => {
    setSearchQuery('');
    setDebouncedSearchQuery('');
  }, []);
  useEffect(() => {
    if (searchQuery.length === 0) {
      setDebouncedSearchQuery('');
      return;
    }
    const handle = setTimeout(() => setDebouncedSearchQuery(searchQuery), 120);
    return () => clearTimeout(handle);
  }, [searchQuery]);

  // Match modal state
  const [matchModalVisible, setMatchModalVisible] = useState(false);
  const [matchedProfile, setMatchedProfile] = useState<any>(null);
  const modalScale = useRef(new Animated.Value(0)).current;
  const heartScale = useRef(new Animated.Value(0)).current;
  // BUGFIX #25: Track running animation for cleanup on unmount
  const matchAnimationRef = useRef<Animated.CompositeAnimation | null>(null);

  // BUGFIX #25: Stop animations on unmount
  useEffect(() => {
    return () => {
      if (matchAnimationRef.current) {
        matchAnimationRef.current.stop();
        matchAnimationRef.current = null;
      }
      // Reset animated values to prevent memory leaks
      modalScale.setValue(0);
      heartScale.setValue(0);
    };
  }, [modalScale, heartScale]);

  // FlatList ref for scrolling to specific like
  const likesListRef = useRef<FlatList>(null);

  // BUGFIX #5: Track if list layout is ready (prevents scrollToIndex crash)
  const likesListLayoutReady = useRef(false);

  // Stability fix: track scroll timeout for cleanup on unmount/blur
  const scrollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // FOCUS-GUARD: Prevent repeated markLikesOpened calls on tab focus
  const hasMarkedLikesOpenedRef = useRef(false);

  // P0/P1 MESSAGES_ENTRY: Track which (focus=likes + profileId) instance we
  // already consumed. When the user taps a notification with
  // focus=likes&profileId=X, Expo Router keeps those params attached to this
  // route. Without a guard, every subsequent tab re-focus would re-trigger
  // the auto-switch to the Likes view — which is the exact bug this guards
  // against. We consume each param instance ONCE and thereafter ignore the
  // stale params on later focuses.
  const consumedFocusKeyRef = useRef<string>('');

  // Demo store — seed on mount, read mutable matches/likes
  const demoMatches = useDemoStore((s) => s.matches);
  const demoLikesRaw = useDemoStore((s) => s.likes);
  const demoSeed = useDemoStore((s) => s.seed);
  const blockedUserIds = useBlockStore((s) => s.blockedUserIds);
  const removeLike = useDemoStore((s) => s.removeLike);
  const simulateMatch = useDemoStore((s) => s.simulateMatch);
  const hasHydrated = useDemoStore((s) => s._hasHydrated);

  // Ensure seed runs on mount (only once per session, after hydration)
  useEffect(() => {
    if (isDemoMode && hasHydrated) {
      demoSeed();
    }
  }, [isDemoMode, hasHydrated, demoSeed]);

  // P0/P1 MESSAGES_ENTRY — Messages tab default entry behavior.
  //
  // Product rule: tapping the Messages tab must ALWAYS land on the Messages
  // home/thread list. "Who liked us" (the Likes in-place view) may only open:
  //   (a) on the very first focus after a notification deep link that carried
  //       ?focus=likes&profileId=X, OR
  //   (b) when the user explicitly taps the heart toggle / Likes CTA.
  //
  // Two guards are layered (see separate effects below):
  //   1. `consumedFocusKeyRef` — only consume each (focus,profileId) URL
  //      param instance once. Subsequent re-focuses of the same route (e.g.
  //      user tabs away and returns) will see the stale params but skip the
  //      auto-switch because the ref already stored that key. (this effect)
  //   2. Blur-reset effect — see the effect right below this one. On blur
  //      (tab switch / push to a sub-route) it resets activeView to
  //      'messages' so the next focus always lands on home.
  //
  // `activeView` is DELIBERATELY NOT in this effect's deps: including it
  // would cause the cleanup to fire whenever the user toggles the heart,
  // which would undo their manual tap. We use a ref (`activeViewRef` below)
  // purely for log snapshotting.
  const activeViewRef = useRef<'messages' | 'likes'>('messages');
  useEffect(() => {
    activeViewRef.current = activeView;
  }, [activeView]);

  useFocusEffect(
    useCallback(() => {
      const focusParam = typeof focus === 'string' ? focus : null;
      const profileParam = typeof profileId === 'string' ? profileId : null;
      const currentKey = focusParam === 'likes' ? `likes:${profileParam ?? ''}` : '';

      if (__DEV__) {
        console.log('[MESSAGES_ENTRY][focus]', {
          focus: focusParam,
          profileId: profileParam,
          currentKey,
          consumedKey: consumedFocusKeyRef.current,
          activeView: activeViewRef.current,
        });
      }

      const shouldApplyLikesFocus =
        currentKey !== '' && consumedFocusKeyRef.current !== currentKey;

      if (shouldApplyLikesFocus) {
        consumedFocusKeyRef.current = currentKey;
        if (__DEV__) {
          console.log('[MESSAGES_ENTRY][auto_redirect]', {
            target: 'likes',
            reason: 'notification_deeplink_focus_likes',
            triggeredByUserAction: false,
            focus: focusParam,
            profileId: profileParam,
          });
        }
        setActiveView('likes');

        // LIFECYCLE: Mark likes as opened when arriving via deep link
        // FOCUS-GUARD: Only call once per session to avoid repeated API calls
        if (!isDemoMode && token && !hasMarkedLikesOpenedRef.current) {
          hasMarkedLikesOpenedRef.current = true;
          markLikesOpened({ token }).catch((err) => {
            // Reset guard on failure so retry is possible
            hasMarkedLikesOpenedRef.current = false;
            log.warn('[MESSAGES]', 'markLikesOpened (deeplink) failed', { error: err });
          });
        }

        // If profileId is provided, scroll to that like after render
        if (profileParam && likesListRef.current) {
          // Stability fix: clear any pending scroll timeout
          if (scrollTimeoutRef.current) {
            clearTimeout(scrollTimeoutRef.current);
          }
          scrollTimeoutRef.current = setTimeout(() => {
            // Guard: ensure list ref still exists after timeout
            if (!likesListRef.current) return;

            const idx = demoLikesRaw.findIndex((l) => l.userId === profileParam);
            // BUGFIX #5: Bounds checks before scrollToIndex to prevent crash
            // 1) idx must be >= 0 (findIndex returns -1 if not found)
            // 2) Row index must be within bounds (2-column grid)
            // 3) List layout must be ready
            const rowIndex = Math.floor(idx / 2);
            const maxRowIndex = Math.ceil(demoLikesRaw.length / 2) - 1;

            if (idx < 0) {
              // Profile not found — likely deleted, scroll to top instead
              log.warn('[MESSAGES]', 'scrollToIndex: profile not found', { profileId: profileParam });
              likesListRef.current?.scrollToOffset({ offset: 0, animated: true });
              return;
            }

            if (rowIndex > maxRowIndex || maxRowIndex < 0) {
              // Out of bounds — scroll to top
              log.warn('[MESSAGES]', 'scrollToIndex: row out of bounds', { rowIndex, maxRowIndex });
              likesListRef.current?.scrollToOffset({ offset: 0, animated: true });
              return;
            }

            if (!likesListLayoutReady.current) {
              // Layout not ready — scroll to top as safe fallback
              log.info('[MESSAGES]', 'scrollToIndex: layout not ready, fallback to top');
              likesListRef.current?.scrollToOffset({ offset: 0, animated: true });
              return;
            }

            // Safe to scroll
            likesListRef.current?.scrollToIndex({ index: rowIndex, animated: true });
          }, 150); // Slightly longer delay to allow layout
        }
      } else if (currentKey !== '' && __DEV__) {
        // Stale URL param from a prior deep link — deliberately ignored.
        console.log('[MESSAGES_ENTRY][route_restore]', {
          reason: 'stale_focus_param_ignored',
          currentKey,
          consumedKey: consumedFocusKeyRef.current,
          activeView: activeViewRef.current,
        });
      }

      if (__DEV__) {
        console.log('[MESSAGES_ENTRY][final_screen]', {
          activeView: shouldApplyLikesFocus ? 'likes' : activeViewRef.current,
          appliedDeepLink: shouldApplyLikesFocus,
        });
      }

      // Cleanup: clear pending scroll timeout on blur/unmount.
      // NOTE: the activeView reset lives in the separate blur-reset effect
      // below so that it does NOT fire on dep-driven re-registrations of
      // this effect (otherwise it would clobber the very setActiveView
      // call we just made).
      return () => {
        if (scrollTimeoutRef.current) {
          clearTimeout(scrollTimeoutRef.current);
          scrollTimeoutRef.current = null;
        }
      };
    }, [focus, profileId, demoLikesRaw])
  );

  // Blur-reset effect: on blur (tab switch / push to a sub-route) reset
  // activeView to 'messages'. Empty deps → never re-registers → cleanup
  // fires only on genuine blur/unmount, not on dep changes.
  useFocusEffect(
    useCallback(() => {
      return () => {
        if (__DEV__) {
          console.log('[MESSAGES_ENTRY][tab_press]', {
            event: 'blur_or_unmount',
            priorActiveView: activeViewRef.current,
            resetTo: 'messages',
          });
        }
        setActiveView('messages');
      };
    }, [])
  );

  // Android back button handler — if in Likes view, go back to Messages home
  useFocusEffect(
    useCallback(() => {
      const onBackPress = () => {
        if (activeView === 'likes') {
          setActiveView('messages');
          return true; // Handled — don't navigate away
        }
        return false; // Not handled — default back behavior
      };

      const subscription = BackHandler.addEventListener('hardwareBackPress', onBackPress);
      return () => subscription.remove();
    }, [activeView])
  );

  useFocusEffect(
    useCallback(() => {
      if (activeView !== 'messages') return undefined;

      setInboxTimeReferenceMs(Date.now());
      const interval = setInterval(() => {
        setInboxTimeReferenceMs(Date.now());
      }, INBOX_TIMESTAMP_REFRESH_MS);

      return () => clearInterval(interval);
    }, [activeView])
  );

  // HIGH #1 FIX: Memoize Convex query args to prevent re-subscriptions
  // Creating new object references on every render causes Convex to re-subscribe
  // FIX: Use correct argument names for each API endpoint
  const convexConversationsArgs = useMemo(
    () => (!isDemoMode && userId ? { authUserId: userId } : 'skip' as const),
    [userId, retryKey]
  );
  const convexUnreadArgs = useMemo(
    () => (!isDemoMode && userId ? { userId } : 'skip' as const),
    [userId, retryKey]
  );
  const convexQueryArgs = useMemo(
    () => (!isDemoMode && convexUserId ? { userId: convexUserId } : 'skip' as const),
    [convexUserId, retryKey]
  );

  // Convex queries (skipped in demo mode)
  const convexConversations = useQuery(api.messages.getConversations, convexConversationsArgs);
  const convexUnreadCount = useQuery(api.messages.getUnreadCount, convexUnreadArgs);
  const convexCurrentUser = useQuery(api.users.getCurrentUser, convexQueryArgs);
  const convexLikesReceived = useQuery(api.likes.getLikesReceived, convexQueryArgs);
  const convexMatches = useQuery(api.matches.getMatches, convexQueryArgs);

  // Mutation to mark likes as opened (starts 24h expiry timer)
  const markLikesOpened = useMutation(api.likes.markLikesOpened);

  // DELIVERED-TICK-FIX: Mark all incoming messages as delivered when messages list loads
  const markAllAsDelivered = useMutation(api.messages.markAllAsDelivered);

  // Demo DM store for thread model
  const demoMeta = useDemoDmStore((s) => s.meta);
  const demoConversations = useDemoDmStore((s) => s.conversations);
  const cleanupExpiredThreads = useDemoDmStore((s) => s.cleanupExpiredThreads);

  // Process threads using threadsIntegrity
  const {
    newMatches: demoNewMatches,
    messageThreads: demoMessageThreads,
    confessionThreads: demoConfessionThreads,
    expiredThreadIds,
    totalUnreadCount: demoUnreadCount,
  } = useMemo(() => {
    if (!isDemoMode) {
      return {
        newMatches: [],
        messageThreads: [],
        confessionThreads: [],
        expiredThreadIds: [],
        totalUnreadCount: 0,
      };
    }
    return processThreadsIntegrity({
      matches: demoMatches,
      conversations: demoConversations,
      meta: demoMeta,
      blockedUserIds,
      currentUserId: userId || 'demo_user_1',
    });
  }, [isDemoMode, demoMatches, demoConversations, demoMeta, blockedUserIds, userId]);

  // Cleanup expired threads on mount/refresh
  useEffect(() => {
    if (isDemoMode && expiredThreadIds.length > 0) {
      cleanupExpiredThreads(expiredThreadIds);
    }
  }, [isDemoMode, expiredThreadIds, cleanupExpiredThreads]);

  // DELIVERED-TICK-FIX: Mark all incoming messages as delivered when messages arrive
  // This ensures "delivered" state (two gray ticks) is set as soon as messages reach the device,
  // BEFORE the user opens any specific conversation. The dependency on convexConversations
  // ensures this runs whenever new messages arrive via Convex real-time sync.
  // Note: This is separate from "read" (blue ticks) which only happens when user opens the chat.
  useEffect(() => {
    // Only run when we have conversation data (meaning messages have arrived)
    if (!isDemoMode && userId && convexConversations && convexConversations.length > 0) {
      markAllAsDelivered({ authUserId: userId }).catch(() => {
        // Silent fail - delivery marking is best-effort
      });
    }
  }, [isDemoMode, userId, convexConversations, markAllAsDelivered]);

  // Combine message threads
  const demoThreads = useMemo(() => {
    if (!isDemoMode) return [];
    return [...demoMessageThreads, ...demoConfessionThreads].sort(
      (a, b) => b._sortTs - a._sortTs
    );
  }, [isDemoMode, demoMessageThreads, demoConfessionThreads]);

  // FIX: Filter out conversations without messages — those should only appear in
  // Super Likes / New Matches section, not in the Messages list. This prevents
  // the same profile from appearing in both places.
  // P1-RESTORE: Always keep rows in a terminalState (unmatched / user_removed)
  // so the user sees the graceful "User unavailable" degraded row instead of
  // the conversation silently disappearing.
  const conversations = useMemo(() => {
    if (isDemoMode) return demoThreads;
    if (!convexConversations) return [];
    return convexConversations.filter(
      (c: any) => c.lastMessage !== null || c.terminalState != null,
    );
  }, [isDemoMode, demoThreads, convexConversations]);

  // P0-RESTORE: Batch-fetch presence for the visible inbox rows so the green
  // "active now" dot lights up via the unified presence system. Returns a map
  // keyed by userId -> PresenceInfo.
  const conversationOtherUserIds = useMemo(() => {
    const ids: Id<'users'>[] = [];
    for (const c of conversations as any[]) {
      const id = c?.otherUser?.id;
      if (typeof id === 'string' && id.length > 0) {
        ids.push(id as Id<'users'>);
      }
    }
    return ids;
  }, [conversations]);
  const conversationPresenceByUserId = useBatchPresence(conversationOtherUserIds) ?? null;
  const unreadCount = isDemoMode ? demoUnreadCount : convexUnreadCount;
  const currentUser = isDemoMode
    ? { gender: 'male', subscriptionTier: 'premium' as const }
    : convexCurrentUser;

  // Build matched user IDs set for likes filtering
  const matchedUserIds = useMemo(() => {
    if (isDemoMode) {
      return new Set(demoMatches.map((m) => m.otherUser?.id).filter(Boolean) as string[]);
    }
    // Convex mode: use real matches
    const matches = (convexMatches || []) as any[];
    return new Set(matches.map((m) => m.user?.id).filter(Boolean) as string[]);
  }, [isDemoMode, demoMatches, convexMatches]);

  // Process likes — filter out blocked and already-matched users
  // IMPORTANT: Use demoLikesRaw directly, only filter blocked/matched
  const allLikes = useMemo(() => {
    if (!isDemoMode) {
      // Convex mode
      const likes = (convexLikesReceived || []) as any[];
      return likes.filter((l) => {
        if (blockedUserIds.includes(l.userId)) return false;
        if (matchedUserIds.has(l.userId)) return false;
        return true;
      });
    }

    // Demo mode — use raw likes from store, filter blocked/matched
    const filtered = demoLikesRaw.filter((l) => {
      if (blockedUserIds.includes(l.userId)) return false;
      if (matchedUserIds.has(l.userId)) return false;
      return true;
    });

    // Only log if there's a potential issue (raw > 0 but filtered = 0)
    if (demoLikesRaw.length > 0 && filtered.length === 0) {
      log.warn('[LIKES]', 'all filtered', { raw: demoLikesRaw.length, matched: matchedUserIds.size });
    }

    return filtered;
  }, [isDemoMode, demoLikesRaw, convexLikesReceived, blockedUserIds, matchedUserIds, hasHydrated]);

  // Separate super likes and regular likes (super likes first)
  const { superLikes, regularLikes } = useMemo(() => {
    const supers = allLikes.filter((l: any) => l.action === 'super_like');
    const regular = allLikes.filter((l: any) => l.action !== 'super_like');
    return { superLikes: supers, regularLikes: regular };
  }, [allLikes]);

  // Combined likes for display (super likes first)
  const displayLikes = useMemo(() => {
    return [...superLikes, ...regularLikes];
  }, [superLikes, regularLikes]);

  const handleConversationPress = useCallback((item: InboxConversationRow) => {
    const routeId = getConversationRouteId(item);
    if (!routeId) return;

    safePush(router, `/(main)/(tabs)/messages/chat/${routeId}` as any, 'messages->chat');
  }, [router]);

  const handleConversationAvatarPress = useCallback((item: InboxConversationRow) => {
    const otherUserId = getNonEmptyString(item.otherUser?.id);
    if (!otherUserId) return;

    safePush(router, `/(main)/profile/${otherUserId}` as any, 'messages->avatarProfile');
  }, [router]);

  // Pending likes count (for header badge)
  const pendingLikesCount = displayLikes.length;

  // Profile completeness nudge
  const dismissedNudges = useDemoStore((s) => s.dismissedNudges);
  const dismissNudge = useDemoStore((s) => s.dismissNudge);
  const nudgeUser = isDemoMode ? getDemoCurrentUser() : convexCurrentUser;
  const messagesNudgeStatus = nudgeUser
    ? getProfileCompleteness({
        photoCount: Array.isArray(nudgeUser.photos) ? nudgeUser.photos.length : 0,
        bioLength: (nudgeUser as any).bio?.length ?? 0,
      })
    : 'complete';
  const showMessagesNudge =
    messagesNudgeStatus === 'needs_both' && !dismissedNudges.includes('messages');

  const refetchLiveMessagesData = useCallback(async () => {
    if (isDemoMode || !userId || !convexUserId) {
      return;
    }

    setRetryKey((k) => k + 1);

    await Promise.all([
      convex.query(api.messages.getConversations, { authUserId: userId }),
      convex.query(api.messages.getUnreadCount, { userId }),
      convex.query(api.users.getCurrentUser, { userId: convexUserId }),
      convex.query(api.likes.getLikesReceived, { userId: convexUserId }),
      convex.query(api.matches.getMatches, { userId: convexUserId }),
    ]);
  }, [convex, convexUserId, isDemoMode, userId]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);

    try {
      if (isDemoMode) {
        demoSeed();
        return;
      }

      await refetchLiveMessagesData();
    } catch (error) {
      log.warn('[MESSAGES]', 'refresh failed', { error });
      Toast.show('Couldn’t refresh messages. Please try again.');
    } finally {
      if (isDemoMode) {
        safeTimeout(() => setRefreshing(false), 300);
      } else {
        setRefreshing(false);
      }
    }
  }, [demoSeed, isDemoMode, refetchLiveMessagesData, safeTimeout]);

  const handleRetry = useCallback(() => {
    if (isDemoMode) {
      demoSeed();
      return;
    }

    void refetchLiveMessagesData().catch((error) => {
      log.warn('[MESSAGES]', 'retry failed', { error });
      Toast.show('Couldn’t reload messages. Please try again.');
    });
  }, [demoSeed, isDemoMode, refetchLiveMessagesData]);

  // Process matches: separate Super Likes (above) from New Matches
  // A match is "new" if it has no messages yet (lastMessage is null)
  const { superLikeMatches, newMatches } = useMemo(() => {
    if (isDemoMode) {
      // Demo mode: all new matches are regular (no super_like tracking in demo)
      return { superLikeMatches: [], newMatches: demoNewMatches };
    }

    // Convex mode: process real matches
    const matches = (convexMatches || []) as any[];
    const superLikes: any[] = [];
    const regular: any[] = [];

    for (const match of matches) {
      // Only include matches with no messages (new matches)
      if (match.lastMessage) continue;

      // FIX: Defensive check — skip matches without valid matchId (prevents keyExtractor crash)
      if (!match.matchId) {
        log.warn('[MESSAGES]', 'Skipping match without matchId', { match });
        continue;
      }

      // Transform to the format expected by renderNewMatchesRow
      const transformed = {
        id: match.matchId,
        conversationId: match.conversationId,
        matchSource: match.matchSource || 'like',
        otherUser: {
          id: match.user?.id,
          name: match.user?.name,
          photoUrl: match.user?.photoUrl,
          lastActive: match.user?.lastActive,
          isVerified: match.user?.isVerified,
        },
      };

      if (match.matchSource === 'super_like') {
        superLikes.push(transformed);
      } else {
        regular.push(transformed);
      }
    }

    return { superLikeMatches: superLikes, newMatches: regular };
  }, [isDemoMode, demoNewMatches, convexMatches]);

  // ── Like actions ──

  const handlePass = useCallback(async (like: any) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (isDemoMode) {
      removeLike(like.userId);
    } else {
      // Convex mode: call swipe mutation with 'pass' action
      // P1-010 FIX: Show user feedback instead of silent return
      if (!token || !like.userId) {
        Toast.show('Unable to pass. Please try again.');
        return;
      }
      try {
        await swipe({
          token,
          toUserId: like.userId,
          action: 'pass',
        });
      } catch (error) {
        log.error('[MESSAGES]', 'handlePass failed', { error });
      }
    }
  }, [removeLike, token, swipe]);

  const handleLikeBack = useCallback(async (like: any) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    if (isDemoMode) {
      // Get profile info for modal
      const profile = DEMO_PROFILES.find((p) => p._id === like.userId);
      const matchedInfo = {
        userId: like.userId,
        name: like.name || profile?.name || 'Someone',
        photoUrl: like.photoUrl || profile?.photos?.[0]?.url,
        age: like.age || profile?.age,
      };

      // Remove from likes and create match
      removeLike(like.userId);
      simulateMatch(like.userId);

      // Show match modal
      setMatchedProfile(matchedInfo);
      setMatchModalVisible(true);

      // BUGFIX #25: Stop any running animation before starting new one
      if (matchAnimationRef.current) {
        matchAnimationRef.current.stop();
      }

      // Animate modal entrance
      matchAnimationRef.current = Animated.parallel([
        Animated.spring(modalScale, {
          toValue: 1,
          useNativeDriver: true,
          tension: 80,
          friction: 12,
        }),
        Animated.sequence([
          Animated.delay(200),
          Animated.spring(heartScale, {
            toValue: 1.2,
            useNativeDriver: true,
          }),
          Animated.spring(heartScale, {
            toValue: 1,
            useNativeDriver: true,
          }),
        ]),
      ]);
      matchAnimationRef.current.start(() => {
        matchAnimationRef.current = null;
      });

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } else {
      // Convex mode: call swipe mutation with 'like' action
      if (!token || !like.userId) return;
      try {
        const result = await swipe({
          token,
          toUserId: like.userId,
          action: 'like',
        });

        // If mutual like, it's a match - navigate to match celebration
        if (result.isMatch && result.matchId) {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          safePush(router, `/(main)/match-celebration?matchId=${result.matchId}&userId=${like.userId}` as any, 'messages->matchCelebration');
        }
      } catch (error) {
        log.error('[MESSAGES]', 'handleLikeBack failed', { error });
      }
    }
  }, [removeLike, simulateMatch, modalScale, heartScale, token, swipe, router]);

  const handleSayHi = useCallback(() => {
    if (!matchedProfile) return;

    const convoId = `demo_convo_${matchedProfile.userId}`;

    // Pre-fill draft
    useDemoDmStore.getState().setDraft(convoId, 'Hi');

    // Close modal and navigate
    setMatchModalVisible(false);
    modalScale.setValue(0);
    heartScale.setValue(0);
    setMatchedProfile(null);

    // Navigate to chat
    safePush(router, `/(main)/(tabs)/messages/chat/${convoId}?source=match` as any, 'messages->matchChat');
  }, [matchedProfile, router, modalScale, heartScale]);

  const handleKeepDiscovering = useCallback(() => {
    setMatchModalVisible(false);
    modalScale.setValue(0);
    heartScale.setValue(0);
    setMatchedProfile(null);

    // Switch back to messages view to show new match in New Matches row
    setActiveView('messages');
  }, [modalScale, heartScale]);

  const handleProfileTap = useCallback((like: any) => {
    safePush(router, `/(main)/profile/${like.userId}` as any, 'messages->likeProfile');
  }, [router]);

  // Back to messages (for in-place header button)
  const handleBackToMessages = useCallback(() => {
    // BUGFIX #5: Reset layout ready flag since FlatList will be destroyed
    likesListLayoutReady.current = false;
    setActiveView('messages');
  }, []);

  // ── Render functions ──

  const renderLikeCard = ({ item: like }: { item: any }) => {
    const isRecent = isRecentLike(like.createdAt || Date.now());
    const isSuperLike = like.action === 'super_like';

    // Border color: blue for super like, pink for regular like
    const borderStyle = isSuperLike
      ? { borderColor: COLORS.superLike, borderWidth: 2 }
      : { borderColor: COLORS.primary, borderWidth: 2 };

    return (
      <View style={[styles.likeCard, borderStyle, isRecent && styles.likeCardRecent]}>
        <TouchableOpacity
          style={styles.likeCardTouchable}
          activeOpacity={0.8}
          onPress={() => handleProfileTap(like)}
        >
          {/* Photo */}
          <View style={styles.likeCardImageContainer}>
            <Image
              source={{ uri: like.photoUrl || 'https://via.placeholder.com/150' }}
              style={styles.likeCardImage}
              contentFit="cover"
            />
            {isSuperLike && (
              <View style={styles.superLikeBadge}>
                <Ionicons name="star" size={MINI_BADGE_ICON_SIZE} color={COLORS.white} />
              </View>
            )}
            {isRecent && (
              <View style={styles.newBadge}>
                <Text {...TEXT_PROPS} style={styles.newBadgeText}>NEW</Text>
              </View>
            )}
          </View>

          {/* Info */}
          <View style={styles.likeCardInfo}>
            <Text {...TEXT_PROPS} style={styles.likeCardName} numberOfLines={1}>
              {like.name || 'Someone'}, {like.age || '?'}
            </Text>
            <Text {...TEXT_PROPS} style={styles.likeCardTime}>
              {formatRelativeTime(like.createdAt || Date.now())}
            </Text>
          </View>

          {/* Standout message (if present) */}
          {like.message && (
            <View style={styles.standoutMessageContainer}>
              <Text {...TEXT_PROPS} style={styles.standoutMessageText} numberOfLines={2}>
                "{like.message}"
              </Text>
            </View>
          )}
        </TouchableOpacity>

        {/* Action buttons */}
        <View style={styles.likeCardActions}>
          <TouchableOpacity
            style={styles.passButton}
            onPress={() => handlePass(like)}
            activeOpacity={0.7}
          >
            <Ionicons name="close" size={ACTION_ICON_SIZE} color="#F44336" />
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.likeBackButton}
            onPress={() => handleLikeBack(like)}
            activeOpacity={0.7}
          >
            <Ionicons name="heart" size={ACTION_ICON_SIZE} color={COLORS.white} />
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  // Super Likes section (above New Matches) - only renders when there's data
  const renderSuperLikesRow = () => {
    // Only render if we have real super like matches
    if (!superLikeMatches || superLikeMatches.length === 0) {
      return null;
    }

    return (
      <View style={styles.superLikesSection}>
        <View style={styles.compactSectionHeader}>
          <Ionicons name="star" size={SIZES.icon.sm} color={COLORS.superLike} />
          <Text {...TEXT_PROPS} style={styles.compactSectionTitle}>Super Likes</Text>
          <View style={[styles.countBadge, { backgroundColor: COLORS.superLike + '20' }]}>
            <Text {...TEXT_PROPS} style={[styles.countBadgeText, { color: COLORS.superLike }]}>
              {superLikeMatches.length}
            </Text>
          </View>
        </View>
        <FlatList
          horizontal
          data={superLikeMatches}
          keyExtractor={(item: any) => item.id || item.matchId || `superlike-${item.otherUser?.id}`}
          renderItem={({ item }: { item: any }) => (
            <TouchableOpacity
              style={styles.compactMatchItem}
              activeOpacity={0.7}
              onPress={() => {
                if (item.conversationId) {
                  safePush(router, `/(main)/(tabs)/messages/chat/${item.conversationId}` as any, 'messages->superLikeChat');
                } else {
                  log.warn('[MESSAGES]', 'Super Like card missing conversationId', { matchId: item.id });
                }
              }}
            >
              <View style={styles.compactAvatarContainer}>
                <View style={[styles.compactMatchRing, { borderColor: COLORS.superLike }]}>
                  {item.otherUser?.photoUrl ? (
                    <Image
                      source={{ uri: item.otherUser.photoUrl }}
                      style={styles.compactMatchAvatar}
                      contentFit="cover"
                    />
                  ) : (
                    <View style={[styles.compactMatchAvatar, styles.placeholderAvatar]}>
                      <Text {...TEXT_PROPS} style={styles.compactAvatarInitial}>
                        {item.otherUser?.name?.[0] || '?'}
                      </Text>
                    </View>
                  )}
                </View>
                {/* Super Like star badge */}
                <View style={styles.compactSuperLikeBadge}>
                  <Ionicons name="star" size={COMPACT_BADGE_ICON_SIZE} color={COLORS.white} />
                </View>
              </View>
            </TouchableOpacity>
          )}
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.compactMatchesList}
        />
      </View>
    );
  };

  // New Matches section - only renders when there's data
  const renderNewMatchesRow = () => {
    // Only render if we have real new matches
    if (!newMatches || newMatches.length === 0) {
      return null;
    }

    return (
      <View style={styles.newMatchesSection}>
        <View style={styles.compactSectionHeader}>
          <Ionicons name="heart-circle" size={SIZES.icon.sm} color={COLORS.primary} />
          <Text {...TEXT_PROPS} style={styles.compactSectionTitle}>New Matches</Text>
          <View style={[styles.countBadge, { backgroundColor: COLORS.primary + '20' }]}>
            <Text {...TEXT_PROPS} style={[styles.countBadgeText, { color: COLORS.primary }]}>
              {newMatches.length}
            </Text>
          </View>
        </View>
        <FlatList
          horizontal
          data={newMatches}
          keyExtractor={(item: any) => item.id || item.matchId || `newmatch-${item.otherUser?.id}`}
          renderItem={({ item }: { item: any }) => (
            <TouchableOpacity
              style={styles.compactMatchItem}
              activeOpacity={0.7}
              onPress={async () => {
                if (item.conversationId) {
                  safePush(router, `/(main)/(tabs)/messages/chat/${item.conversationId}` as any, 'messages->newMatchChat');
                  return;
                }
                // P0-RESTORE: Match cards may not have a conversationId yet.
                // Lazily create the conversation via ensureConversation, then
                // navigate. Without this fallback the tap silently fails.
                const matchId = item.id || item.matchId;
                if (!matchId || !userId) {
                  log.warn('[MESSAGES]', 'New Match card cannot create conversation', {
                    matchId,
                    hasUserId: !!userId,
                  });
                  Toast.show('Unable to open chat. Please try again.');
                  return;
                }
                try {
                  const result = await ensureConversation({ matchId: matchId as any, authUserId: userId });
                  if (result?.conversationId) {
                    safePush(
                      router,
                      `/(main)/(tabs)/messages/chat/${result.conversationId}` as any,
                      'messages->newMatchChat',
                    );
                  } else {
                    log.error('[MESSAGES]', 'ensureConversation returned no conversationId', { result });
                    Toast.show('Unable to open chat. Please try again.');
                  }
                } catch (error) {
                  log.error('[MESSAGES]', 'ensureConversation failed', { error, matchId });
                  Toast.show('Unable to open chat. Please try again.');
                }
              }}
            >
              <View style={styles.compactAvatarContainer}>
                <View style={[styles.compactMatchRing, { borderColor: COLORS.primary }]}>
                  {item.otherUser?.photoUrl ? (
                    <Image
                      source={{ uri: item.otherUser.photoUrl }}
                      style={styles.compactMatchAvatar}
                      contentFit="cover"
                    />
                  ) : (
                    <View style={[styles.compactMatchAvatar, styles.placeholderAvatar]}>
                      <Text {...TEXT_PROPS} style={styles.compactAvatarInitial}>
                        {item.otherUser?.name?.[0] || '?'}
                      </Text>
                    </View>
                  )}
                </View>
              </View>
            </TouchableOpacity>
          )}
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.compactMatchesList}
        />
      </View>
    );
  };

  // Loading state
  const isLoading = !isDemoMode && convexConversations === undefined;

  if (isLoading) {
    return (
      <LoadingGuard
        isLoading={true}
        onRetry={handleRetry}
        title="Loading your inbox..."
        subtitle="We are syncing your latest conversations. Please try again if this takes too long."
      >
        <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
          <View style={styles.header}>
            <Text {...TEXT_PROPS} style={styles.title}>Messages</Text>
          </View>
          <View style={styles.loadingContainer}>
            <View style={styles.loadingStatus}>
              <ActivityIndicator size="small" color={COLORS.primary} />
              <Text {...TEXT_PROPS} style={styles.helperText}>
                Bringing your conversations up to date...
              </Text>
            </View>
            <View style={styles.loadingList}>
              {Array.from({ length: INBOX_LOADING_PLACEHOLDER_COUNT }, (_, index) => (
                <SkeletonChatRow key={`messages-loading-${index}`} />
              ))}
            </View>
          </View>
        </SafeAreaView>
      </LoadingGuard>
    );
  }

  // ── Main render ──

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      {/* Header — changes based on activeView */}
      <View style={styles.header}>
        {activeView === 'likes' ? (
          // Likes view header with back arrow
          <>
            <TouchableOpacity
              style={styles.backButton}
              onPress={handleBackToMessages}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <Ionicons name="arrow-back" size={HEADER_ICON_SIZE} color={COLORS.text} />
            </TouchableOpacity>
            <Text {...TEXT_PROPS} style={styles.title}>
              {pendingLikesCount} {pendingLikesCount === 1 ? 'Like' : 'Likes'}
            </Text>
            <View style={styles.headerPlaceholder} />
          </>
        ) : (
          // Messages view header
          <>
            <Text {...TEXT_PROPS} style={styles.title}>Messages</Text>
            <View style={styles.headerRight}>
              {/* Likes icon with badge */}
              <TouchableOpacity
                style={[
                  styles.likesButton,
                  pendingLikesCount > 0 && styles.likesButtonHighlight,
                ]}
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  // BUGFIX #5: Reset layout ready flag since FlatList will be created fresh
                  likesListLayoutReady.current = false;
                  setActiveView('likes');
                  // LIFECYCLE: Mark likes as opened (starts 24h expiry timer)
                  if (!isDemoMode && token) {
                    markLikesOpened({ token }).catch((err) => {
                      log.warn('[MESSAGES]', 'markLikesOpened failed', { error: err });
                    });
                  }
                }}
              >
                <Ionicons
                  name="heart"
                  size={HEADER_ICON_SIZE}
                  color={pendingLikesCount > 0 ? COLORS.primary : COLORS.textLight}
                />
                {pendingLikesCount > 0 && (
                  <View style={styles.likesBadge}>
                    <Text {...TEXT_PROPS} style={styles.likesBadgeText}>
                      {pendingLikesCount > 99 ? '99+' : pendingLikesCount}
                    </Text>
                  </View>
                )}
              </TouchableOpacity>
            </View>
          </>
        )}
      </View>

      {/* Content — switches based on activeView */}
      {activeView === 'likes' ? (
        // Likes view (IN-PLACE, not a separate route)
        // key="likes-grid" forces remount when switching views (fixes numColumns error)
        <FlatList
          key="likes-grid"
          ref={likesListRef}
          data={displayLikes}
          numColumns={2}
          keyExtractor={(item: any) => `like-${item.likeId || item.userId}`}
          renderItem={renderLikeCard}
          contentContainerStyle={displayLikes.length === 0 ? styles.emptyListContainer : styles.likesListContent}
          columnWrapperStyle={displayLikes.length > 0 ? styles.likesColumnWrapper : undefined}
          // BUGFIX #5: Track layout ready state for safe scrollToIndex
          onLayout={() => {
            likesListLayoutReady.current = true;
          }}
          // BUGFIX #5: Handle scrollToIndex failure gracefully
          onScrollToIndexFailed={(info) => {
            log.warn('[MESSAGES]', 'onScrollToIndexFailed', {
              index: info.index,
              highestMeasuredFrameIndex: info.highestMeasuredFrameIndex,
              averageItemLength: info.averageItemLength,
            });
            // Retry once after a short delay, or fall back to scroll to top
            setTimeout(() => {
              const maxRowIndex = Math.ceil(displayLikes.length / 2) - 1;
              if (
                likesListRef.current &&
                info.index >= 0 &&
                info.index <= maxRowIndex &&
                maxRowIndex >= 0
              ) {
                // Try scrollToIndex again
                likesListRef.current.scrollToIndex({ index: info.index, animated: true });
              } else {
                // Fall back to scroll to top
                likesListRef.current?.scrollToOffset({ offset: 0, animated: true });
              }
            }, 100);
          }}
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Ionicons name="heart-outline" size={EMPTY_STATE_ICON_SIZE} color={COLORS.textLight} />
              <Text {...TEXT_PROPS} style={styles.emptyTitle}>No likes waiting right now</Text>
              <Text {...TEXT_PROPS} style={styles.emptySubtitle}>
                New likes and super likes will show up here.
              </Text>
            </View>
          }
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        />
      ) : (
        // ════════════════════════════════════════════════════════════════════════
        // MESSAGES VIEW - Clean layout structure (gap fix rewrite)
        // ════════════════════════════════════════════════════════════════════════
        // Structure:
        //   1. Search bar (P1-RESTORE)
        //   2. Optional sections (ProfileNudge, Super Likes, New Matches) - ONLY when not searching
        //   3. FlatList for conversations - NO ListHeaderComponent (avoids gap bug)
        // ════════════════════════════════════════════════════════════════════════
        (() => {
          // P1-POLISH: Use debounced value for filter; raw `searchQuery` still
          // drives the input so typing feels instant.
          const normalizedSearchQuery = debouncedSearchQuery.trim().toLowerCase();
          const isSearching = normalizedSearchQuery.length > 0;
          const baseConversations = (conversations || []) as InboxConversationRow[];
          const filteredConversations = isSearching
            ? baseConversations.filter((conversation) => {
                const haystack = [
                  conversation.otherUser?.name || '',
                  getConversationSearchPreview(conversation.lastMessage, userId || undefined),
                ]
                  .join(' ')
                  .toLowerCase();
                return haystack.includes(normalizedSearchQuery);
              })
            : baseConversations;

          return (
            <View style={styles.messagesContent}>
              {/* P1-RESTORE: Search bar */}
              <View style={styles.searchSection}>
                <View style={styles.searchInputWrap}>
                  <Ionicons name="search" size={18} color={COLORS.textMuted} />
                  <TextInput
                    value={searchQuery}
                    onChangeText={setSearchQuery}
                    placeholder="Search conversations"
                    placeholderTextColor={COLORS.textMuted}
                    style={styles.searchInput}
                    returnKeyType="search"
                    autoCorrect={false}
                    autoCapitalize="none"
                    clearButtonMode="never"
                  />
                  {searchQuery.length > 0 && (
                    <TouchableOpacity
                      onPress={clearSearch}
                      style={styles.searchClearButton}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    >
                      <Ionicons name="close-circle" size={18} color={COLORS.textLight} />
                    </TouchableOpacity>
                  )}
                </View>
              </View>

              {/* Optional top sections - hidden while searching */}
              {!isSearching && showMessagesNudge && (
                <ProfileNudge
                  message={NUDGE_MESSAGES.needs_both.messages}
                  onDismiss={() => dismissNudge('messages')}
                />
              )}
              {!isSearching && superLikeMatches.length > 0 && renderSuperLikesRow()}
              {!isSearching && newMatches.length > 0 && renderNewMatchesRow()}

              {/* Conversation list */}
              <FlatList
                key="messages-list"
                style={styles.conversationList}
                data={filteredConversations}
                keyExtractor={(item, index) => getInboxConversationKey(item as InboxConversationRow, index)}
                keyboardShouldPersistTaps="handled"
                renderItem={({ item }: { item: InboxConversationRow }) => (
                  <ConversationItem
                    id={item.id || item.conversationId || getInboxMatchId(item) || 'conversation'}
                    otherUser={getNormalizedInboxOtherUser(item, conversationPresenceByUserId)}
                    lastMessage={item.lastMessage}
                    unreadCount={item.unreadCount ?? 0}
                    isPreMatch={item.isPreMatch ?? false}
                    currentUserId={userId ?? undefined}
                    currentTimeMs={inboxTimeReferenceMs}
                    onPress={() => handleConversationPress(item)}
                    onAvatarPress={() => handleConversationAvatarPress(item)}
                  />
                )}
                ListEmptyComponent={
                  <View style={styles.emptyContainer}>
                    <Ionicons
                      name={isSearching ? 'search-outline' : 'chatbubbles-outline'}
                      size={EMPTY_STATE_ICON_SIZE}
                      color={COLORS.textLight}
                    />
                    <Text {...TEXT_PROPS} style={styles.emptyTitle}>
                      {isSearching ? 'No matching conversations' : 'Your inbox is quiet for now'}
                    </Text>
                    <Text {...TEXT_PROPS} style={styles.emptySubtitle}>
                      {isSearching
                        ? 'Try a different name or phrase from the last message.'
                        : 'When you match with someone or accept a confession, your conversations will appear here.'}
                    </Text>
                    {isSearching && (
                      <TouchableOpacity style={styles.searchClearAction} onPress={clearSearch}>
                        <Text {...TEXT_PROPS} style={styles.searchClearActionText}>Clear search</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                }
                refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
                contentContainerStyle={
                  filteredConversations.length === 0
                    ? styles.emptyListContainer
                    : styles.conversationListContent
                }
              />
            </View>
          );
        })()
      )}

      {/* Match Modal */}
      <Modal
        visible={matchModalVisible}
        transparent
        animationType="none"
        onRequestClose={handleKeepDiscovering}
      >
        <View style={styles.modalOverlay}>
          <Animated.View
            style={[
              styles.modalContent,
              { transform: [{ scale: modalScale }] },
            ]}
          >
            <LinearGradient
              colors={[COLORS.primary, COLORS.secondary]}
              style={styles.modalGradient}
            >
              <Text {...TEXT_PROPS} style={styles.modalTitle}>It's a Match!</Text>
              <Text {...TEXT_PROPS} style={styles.modalSubtitle}>
                You and {matchedProfile?.name} liked each other
              </Text>

              <Animated.View style={[styles.modalHeart, { transform: [{ scale: heartScale }] }]}>
                <Ionicons name="heart" size={MATCH_MODAL_ICON_SIZE} color={COLORS.white} />
              </Animated.View>

              {matchedProfile?.photoUrl && (
                <Image
                  source={{ uri: matchedProfile.photoUrl }}
                  style={styles.modalPhoto}
                />
              )}

              <View style={styles.modalActions}>
                <TouchableOpacity
                  style={styles.sayHiButton}
                  onPress={handleSayHi}
                >
                  <Text {...TEXT_PROPS} style={styles.sayHiText}>Say Hi 👋</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.keepDiscoveringButton}
                  onPress={handleKeepDiscovering}
                >
                  <Text {...TEXT_PROPS} style={styles.keepDiscoveringText}>Keep Discovering</Text>
                </TouchableOpacity>
              </View>
            </LinearGradient>
          </Animated.View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  // Messages view content wrapper - flex: 1, zero top spacing (gap fix)
  messagesContent: {
    flex: 1,
    marginTop: 0,
    paddingTop: 0,
  },
  // P1-RESTORE: Search bar styles
  searchSection: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 4,
    backgroundColor: COLORS.background,
  },
  searchInputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: 44,
    paddingHorizontal: 14,
    borderRadius: 16,
    backgroundColor: COLORS.backgroundDark,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
    color: COLORS.text,
    paddingVertical: 11,
  },
  searchClearButton: {
    paddingVertical: 4,
    paddingLeft: 4,
  },
  searchClearAction: {
    marginTop: UI_SPACING.md,
    paddingHorizontal: UI_SPACING.base,
    paddingVertical: UI_SPACING.sm,
    borderRadius: 12,
    backgroundColor: COLORS.backgroundDark,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  searchClearActionText: {
    color: COLORS.text,
    fontSize: FONT_SIZE.body,
    fontWeight: '600',
  },
  // HARD FIX: FlatList style - negative margin to pull content up and eliminate gap
  conversationList: {
    flex: 1,
    marginTop: 0,
  },
  // HARD FIX: FlatList content - zero top padding
  conversationListContent: {
    paddingTop: 0,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: UI_SPACING.base,
    paddingVertical: UI_SPACING.md,
    backgroundColor: COLORS.background,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  title: {
    fontSize: TITLE_FONT_SIZE,
    fontWeight: '700',
    color: COLORS.text,
    lineHeight: lineHeight(TITLE_FONT_SIZE, 1.2),
    flex: 1,
  },
  backButton: {
    marginRight: UI_SPACING.md,
  },
  headerPlaceholder: {
    width: SIZES.button.md,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: UI_SPACING.md,
  },
  likesButton: {
    padding: UI_SPACING.sm,
    borderRadius: SIZES.radius.full,
    position: 'relative',
  },
  likesButtonHighlight: {
    backgroundColor: COLORS.primary + '15',
  },
  likesBadge: {
    position: 'absolute',
    top: 0,
    right: 0,
    backgroundColor: COLORS.primary,
    minWidth: LIKES_BADGE_SIZE,
    height: LIKES_BADGE_SIZE,
    borderRadius: SIZES.radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: BADGE_HORIZONTAL_PADDING,
  },
  likesBadgeText: {
    fontSize: FONT_SIZE.xs,
    fontWeight: '700',
    color: COLORS.white,
    lineHeight: lineHeight(FONT_SIZE.xs, 1.2),
  },

  // Likes list
  likesListContent: {
    padding: UI_SPACING.base,
  },
  likesColumnWrapper: {
    gap: UI_SPACING.md,
    marginBottom: UI_SPACING.md,
  },

  // Like Card
  likeCard: {
    flex: 1,
    maxWidth: CARD_WIDTH,
    borderRadius: SIZES.radius.lg,
    overflow: 'hidden',
    backgroundColor: COLORS.backgroundDark,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  likeCardRecent: {
    borderColor: COLORS.primary,
    shadowColor: COLORS.primary,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 4,
  },
  likeCardTouchable: {
    flex: 1,
  },
  likeCardImageContainer: {
    position: 'relative',
  },
  likeCardImage: {
    width: '100%',
    height: CARD_WIDTH * 1.2,
    backgroundColor: COLORS.border,
  },
  superLikeBadge: {
    position: 'absolute',
    top: UI_SPACING.sm,
    right: UI_SPACING.sm,
    backgroundColor: COLORS.superLike,
    borderRadius: SIZES.radius.md,
    padding: moderateScale(5, 0.25),
  },
  newBadge: {
    position: 'absolute',
    top: UI_SPACING.sm,
    left: UI_SPACING.sm,
    backgroundColor: COLORS.primary,
    borderRadius: SIZES.radius.sm,
    paddingHorizontal: UI_SPACING.sm,
    paddingVertical: NEW_BADGE_VERTICAL_PADDING,
  },
  newBadgeText: {
    fontSize: FONT_SIZE.xs,
    fontWeight: '700',
    color: COLORS.white,
    lineHeight: lineHeight(FONT_SIZE.xs, 1.2),
  },
  likeCardInfo: {
    padding: LIKE_CARD_CONTENT_PADDING,
    paddingBottom: moderateScale(6, 0.25),
  },
  likeCardName: {
    fontSize: LIKE_CARD_NAME_SIZE,
    fontWeight: '600',
    color: COLORS.text,
    lineHeight: lineHeight(LIKE_CARD_NAME_SIZE, 1.2),
  },
  likeCardTime: {
    fontSize: FONT_SIZE.caption,
    color: COLORS.textLight,
    lineHeight: lineHeight(FONT_SIZE.caption, 1.35),
    marginTop: UI_SPACING.xxs,
  },
  // Standout message display
  standoutMessageContainer: {
    paddingHorizontal: LIKE_CARD_CONTENT_PADDING,
    paddingBottom: UI_SPACING.sm,
  },
  standoutMessageText: {
    fontSize: FONT_SIZE.caption,
    fontStyle: 'italic',
    color: COLORS.superLike,
    lineHeight: lineHeight(FONT_SIZE.caption, 1.35),
  },
  likeCardActions: {
    flexDirection: 'row',
    paddingHorizontal: LIKE_CARD_CONTENT_PADDING,
    paddingBottom: LIKE_CARD_CONTENT_PADDING,
    gap: LIKE_CARD_CONTENT_PADDING,
  },
  passButton: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: SIZES.button.md,
    borderRadius: SIZES.radius.sm + UI_SPACING.xxs,
    borderWidth: 1.5,
    borderColor: '#F44336',
    backgroundColor: COLORS.background,
  },
  likeBackButton: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: SIZES.button.md,
    borderRadius: SIZES.radius.sm + UI_SPACING.xxs,
    backgroundColor: COLORS.primary,
  },

  // Likes Preview (compact row in messages view)
  likesPreview: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: UI_SPACING.base,
    marginHorizontal: UI_SPACING.base,
    marginTop: UI_SPACING.md,
    backgroundColor: COLORS.primary + '10',
    borderRadius: SIZES.radius.md,
    gap: UI_SPACING.md,
  },
  likesPreviewLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    gap: UI_SPACING.sm,
  },
  likesPreviewText: {
    fontSize: PREVIEW_TEXT_SIZE,
    fontWeight: '600',
    color: COLORS.primary,
    lineHeight: lineHeight(PREVIEW_TEXT_SIZE, 1.2),
  },
  likesPreviewAvatars: {
    flexDirection: 'row',
  },
  likesPreviewAvatar: {
    width: SIZES.avatar.sm,
    height: SIZES.avatar.sm,
    borderRadius: SIZES.radius.full,
    borderWidth: 2,
    borderColor: COLORS.background,
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // COMPACT SECTIONS - Super Likes & New Matches (responsive spacing)
  // ═══════════════════════════════════════════════════════════════════════════

  // Super Likes section (compact)
  superLikesSection: {
    paddingTop: SECTION_SPACING.sectionTop,
    paddingBottom: 0,
  },

  // New Matches Section (compact)
  newMatchesSection: {
    paddingTop: SECTION_SPACING.sectionGap,
    paddingBottom: SECTION_SPACING.sectionGap,
  },

  // Compact section header (shared)
  compactSectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: UI_SPACING.base,
    marginBottom: SECTION_SPACING.titleToRow,
    gap: moderateScale(6, 0.25),
  },
  compactSectionTitle: {
    fontSize: FONT_SIZE.body,
    fontWeight: '600',
    color: COLORS.text,
    lineHeight: lineHeight(FONT_SIZE.body, 1.2),
  },

  // Compact avatar list
  compactMatchesList: {
    paddingLeft: UI_SPACING.base,
    paddingRight: UI_SPACING.base,
  },
  compactMatchItem: {
    marginRight: SECTION_SPACING.avatarGap,
    alignItems: 'center',
  },
  compactAvatarContainer: {
    position: 'relative',
  },
  compactMatchRing: {
    width: SECTION_SPACING.avatarSize + UI_SPACING.sm,
    height: SECTION_SPACING.avatarSize + UI_SPACING.sm,
    borderRadius: SIZES.radius.full,
    borderWidth: 2,
    borderColor: COLORS.primary,
    alignItems: 'center',
    justifyContent: 'center',
    padding: UI_SPACING.xxs,
  },
  compactMatchAvatar: {
    width: SECTION_SPACING.avatarSize,
    height: SECTION_SPACING.avatarSize,
    borderRadius: SIZES.radius.full,
    backgroundColor: COLORS.backgroundDark,
  },
  compactAvatarInitial: {
    fontSize: FONT_SIZE.xl,
    fontWeight: '600',
    color: COLORS.text,
    lineHeight: lineHeight(FONT_SIZE.xl, 1.2),
  },

  // Compact Super Like badge
  compactSuperLikeBadge: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    backgroundColor: COLORS.superLike,
    width: SIZES.icon.sm,
    height: SIZES.icon.sm,
    borderRadius: SIZES.radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: COLORS.background,
  },

  // Legacy styles (kept for compatibility)
  matchesList: {
    paddingLeft: UI_SPACING.base,
    paddingRight: UI_SPACING.xl,
  },
  matchItem: {
    marginRight: UI_SPACING.base,
    alignItems: 'center',
    width: moderateScale(72, 0.25),
  },
  matchAvatarContainer: {
    marginBottom: moderateScale(6, 0.25),
  },
  matchRing: {
    width: moderateScale(68, 0.25),
    height: moderateScale(68, 0.25),
    borderRadius: SIZES.radius.full,
    borderWidth: 2.5,
    borderColor: COLORS.primary,
    alignItems: 'center',
    justifyContent: 'center',
    padding: UI_SPACING.xxs,
  },
  matchAvatar: {
    width: moderateScale(58, 0.25),
    height: moderateScale(58, 0.25),
    borderRadius: SIZES.radius.full,
    backgroundColor: COLORS.backgroundDark,
  },
  matchName: {
    fontSize: FONT_SIZE.caption,
    color: COLORS.text,
    fontWeight: '500',
    textAlign: 'center',
    lineHeight: lineHeight(FONT_SIZE.caption, 1.2),
  },
  countBadge: {
    backgroundColor: COLORS.superLike + '20',
    paddingHorizontal: moderateScale(6, 0.25),
    paddingVertical: moderateScale(1, 0.25),
    borderRadius: SIZES.radius.sm,
  },
  countBadgeText: {
    fontSize: FONT_SIZE.sm,
    fontWeight: '600',
    color: COLORS.superLike,
    lineHeight: lineHeight(FONT_SIZE.sm, 1.2),
  },
  // Placeholder avatar
  placeholderAvatar: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitial: {
    fontSize: FONT_SIZE.title,
    fontWeight: '600',
    color: COLORS.text,
    lineHeight: lineHeight(FONT_SIZE.title, 1.2),
  },

  // Loading
  loadingContainer: {
    flex: 1,
    paddingHorizontal: UI_SPACING.base,
    paddingTop: UI_SPACING.base,
    paddingBottom: UI_SPACING.xl,
  },
  loadingStatus: {
    alignItems: 'center',
    gap: UI_SPACING.md,
    marginBottom: UI_SPACING.lg,
  },
  loadingList: {
    gap: UI_SPACING.xxs,
  },
  loadingConversationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: UI_SPACING.md,
  },
  loadingAvatar: {
    width: moderateScale(52, 0.25),
    height: moderateScale(52, 0.25),
    borderRadius: SIZES.radius.full,
    marginRight: UI_SPACING.md,
    backgroundColor: COLORS.backgroundDark,
  },
  loadingConversationBody: {
    flex: 1,
    gap: LIKE_CARD_CONTENT_PADDING,
  },
  loadingConversationHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: UI_SPACING.md,
  },
  loadingNameBar: {
    width: '40%',
    height: SIZES.icon.sm,
    borderRadius: SIZES.radius.sm,
    backgroundColor: COLORS.backgroundDark,
  },
  loadingTimeBar: {
    width: moderateScale(42, 0.25),
    height: FONT_SIZE.caption,
    borderRadius: moderateScale(6, 0.25),
    backgroundColor: COLORS.backgroundDark,
  },
  loadingPreviewBar: {
    width: '72%',
    height: FONT_SIZE.body,
    borderRadius: moderateScale(7, 0.25),
    backgroundColor: COLORS.backgroundDark,
  },
  helperText: {
    fontSize: FONT_SIZE.body,
    color: COLORS.textLight,
    textAlign: 'center',
    lineHeight: lineHeight(FONT_SIZE.body, 1.35),
    maxWidth: moderateScale(280, 0.25),
  },

  // Empty states
  emptyContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: UI_SPACING.xxl,
  },
  emptyListContainer: {
    flexGrow: 1,
  },
  emptyTitle: {
    fontSize: FONT_SIZE.xxl,
    fontWeight: '600',
    color: COLORS.text,
    lineHeight: lineHeight(FONT_SIZE.xxl, 1.2),
    marginTop: UI_SPACING.base,
    marginBottom: UI_SPACING.sm,
  },
  emptySubtitle: {
    fontSize: FONT_SIZE.body,
    color: COLORS.textLight,
    textAlign: 'center',
    lineHeight: lineHeight(FONT_SIZE.body, 1.35),
    maxWidth: moderateScale(300, 0.25),
  },

  // Match Modal
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalContent: {
    width: SCREEN_WIDTH - UI_SPACING.xxxl,
    borderRadius: SIZES.radius.xl,
    overflow: 'hidden',
  },
  modalGradient: {
    padding: UI_SPACING.xl,
    alignItems: 'center',
  },
  modalTitle: {
    fontSize: MODAL_TITLE_SIZE,
    fontWeight: '700',
    color: COLORS.white,
    lineHeight: lineHeight(MODAL_TITLE_SIZE, 1.2),
    marginBottom: UI_SPACING.sm,
  },
  modalSubtitle: {
    fontSize: MODAL_BODY_SIZE,
    color: COLORS.white,
    opacity: 0.9,
    marginBottom: UI_SPACING.xl,
    textAlign: 'center',
    lineHeight: lineHeight(MODAL_BODY_SIZE, 1.35),
  },
  modalHeart: {
    marginBottom: UI_SPACING.xl,
  },
  modalPhoto: {
    width: MATCH_MODAL_PHOTO_SIZE,
    height: MATCH_MODAL_PHOTO_SIZE,
    borderRadius: SIZES.radius.full,
    borderWidth: 4,
    borderColor: COLORS.white,
    marginBottom: UI_SPACING.xl,
  },
  modalActions: {
    width: '100%',
    gap: UI_SPACING.md,
  },
  sayHiButton: {
    backgroundColor: COLORS.white,
    paddingVertical: UI_SPACING.md,
    borderRadius: SIZES.radius.full,
    alignItems: 'center',
  },
  sayHiText: {
    fontSize: MODAL_BODY_SIZE,
    fontWeight: '600',
    color: COLORS.primary,
    lineHeight: lineHeight(MODAL_BODY_SIZE, 1.2),
  },
  keepDiscoveringButton: {
    paddingVertical: UI_SPACING.md,
    alignItems: 'center',
  },
  keepDiscoveringText: {
    fontSize: MODAL_BODY_SIZE,
    fontWeight: '500',
    color: COLORS.white,
    lineHeight: lineHeight(MODAL_BODY_SIZE, 1.2),
  },
});
