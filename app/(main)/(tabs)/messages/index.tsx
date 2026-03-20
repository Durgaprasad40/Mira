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
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams, useFocusEffect } from 'expo-router';
import { safePush } from '@/lib/safeRouter';
import { LoadingGuard } from '@/components/safety';
import { Image } from 'expo-image';
import { useQuery, useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { useAuthStore } from '@/stores/authStore';
import { COLORS } from '@/lib/constants';
import { ConversationItem } from '@/components/chat';
import { Ionicons } from '@expo/vector-icons';
import { Badge } from '@/components/ui';
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

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const CARD_WIDTH = (SCREEN_WIDTH - 48) / 2;

// ═══════════════════════════════════════════════════════════════════════════
// RESPONSIVE SPACING SYSTEM - Consistent across devices
// ═══════════════════════════════════════════════════════════════════════════
// Base scale factor: smaller phones get slightly tighter spacing
const SCALE_FACTOR = Math.min(SCREEN_WIDTH / 375, 1.1); // Cap at 1.1x for large phones

// Section spacing (compact top sections, more room for messages)
const SPACING = {
  sectionTop: Math.round(8 * SCALE_FACTOR),        // Top padding of sections
  titleToRow: Math.round(6 * SCALE_FACTOR),        // Title to avatar row
  sectionGap: Math.round(8 * SCALE_FACTOR),        // Between Super Likes and New Matches
  beforeMessages: Math.round(12 * SCALE_FACTOR),   // Before Messages list
  avatarSize: Math.round(56 * SCALE_FACTOR),       // Avatar circle size
  avatarGap: Math.round(12 * SCALE_FACTOR),        // Gap between avatars
};

// Recency threshold: 24 hours
const RECENCY_THRESHOLD_MS = 24 * 60 * 60 * 1000;

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

export default function MessagesScreen() {
  useScreenTrace("MESSAGES");
  const router = useRouter();
  const { focus, profileId, source } = useLocalSearchParams<{
    focus?: string;
    profileId?: string;
    source?: string;
  }>();

  const userId = useAuthStore((s) => s.userId);
  const token = useAuthStore((s) => s.token);
  const convexUserId = asUserId(userId);
  const [refreshing, setRefreshing] = useState(false);

  // Swipe mutation for Convex mode like/pass actions
  const swipe = useMutation(api.likes.swipe);
  const [retryKey, setRetryKey] = useState(0);
  const { safeTimeout } = useScreenSafety();

  // View state: 'messages' | 'likes' — IN-PLACE toggle, not a route change
  const [activeView, setActiveView] = useState<'messages' | 'likes'>('messages');

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

  // Track if we arrived from notification to prevent bounce-back
  const arrivedFromNotification = source === 'notification';

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

  // Handle focus param from notification deep link
  useFocusEffect(
    useCallback(() => {
      if (focus === 'likes') {
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
        if (profileId && likesListRef.current) {
          // Stability fix: clear any pending scroll timeout
          if (scrollTimeoutRef.current) {
            clearTimeout(scrollTimeoutRef.current);
          }
          scrollTimeoutRef.current = setTimeout(() => {
            // Guard: ensure list ref still exists after timeout
            if (!likesListRef.current) return;

            const idx = demoLikesRaw.findIndex((l) => l.userId === profileId);
            // BUGFIX #5: Bounds checks before scrollToIndex to prevent crash
            // 1) idx must be >= 0 (findIndex returns -1 if not found)
            // 2) Row index must be within bounds (2-column grid)
            // 3) List layout must be ready
            const rowIndex = Math.floor(idx / 2);
            const maxRowIndex = Math.ceil(demoLikesRaw.length / 2) - 1;

            if (idx < 0) {
              // Profile not found — likely deleted, scroll to top instead
              log.warn('[MESSAGES]', 'scrollToIndex: profile not found', { profileId });
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
      }

      // Cleanup: clear pending scroll timeout on blur/unmount
      return () => {
        if (scrollTimeoutRef.current) {
          clearTimeout(scrollTimeoutRef.current);
          scrollTimeoutRef.current = null;
        }
      };
    }, [focus, profileId, demoLikesRaw])
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

  // HIGH #1 FIX: Memoize Convex query args to prevent re-subscriptions
  // Creating new object references on every render causes Convex to re-subscribe
  // APP-P0-004: Split args - getConversations uses authUserId, others use userId
  const convexConversationsArgs = useMemo(
    () => (!isDemoMode && userId ? { authUserId: userId } : 'skip' as const),
    [userId]
  );
  const convexQueryArgs = useMemo(
    () => (!isDemoMode && convexUserId ? { userId: convexUserId } : 'skip' as const),
    [convexUserId]
  );

  // Convex queries (skipped in demo mode)
  const convexConversations = useQuery(api.messages.getConversations, convexConversationsArgs);
  const convexUnreadCount = useQuery(api.messages.getUnreadCount, convexQueryArgs);
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
  const conversations = useMemo(() => {
    if (isDemoMode) return demoThreads;
    if (!convexConversations) return [];
    // Only show conversations that have at least one message
    return convexConversations.filter((c: any) => c.lastMessage !== null);
  }, [isDemoMode, demoThreads, convexConversations]);
  const unreadCount = isDemoMode ? demoUnreadCount : convexUnreadCount;
  const currentUser = isDemoMode
    ? { gender: 'male', messagesRemaining: 999999, messagesResetAt: undefined, subscriptionTier: 'premium' as const }
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

  const onRefresh = async () => {
    setRefreshing(true);
    // Re-seed if needed
    if (isDemoMode) demoSeed();
    safeTimeout(() => setRefreshing(false), 300);
  };

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
                <Ionicons name="star" size={12} color={COLORS.white} />
              </View>
            )}
            {isRecent && (
              <View style={styles.newBadge}>
                <Text style={styles.newBadgeText}>NEW</Text>
              </View>
            )}
          </View>

          {/* Info */}
          <View style={styles.likeCardInfo}>
            <Text style={styles.likeCardName} numberOfLines={1}>
              {like.name || 'Someone'}, {like.age || '?'}
            </Text>
            <Text style={styles.likeCardTime}>
              {formatRelativeTime(like.createdAt || Date.now())}
            </Text>
          </View>

          {/* Standout message (if present) */}
          {like.message && (
            <View style={styles.standoutMessageContainer}>
              <Text style={styles.standoutMessageText} numberOfLines={2}>
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
            <Ionicons name="close" size={20} color="#F44336" />
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.likeBackButton}
            onPress={() => handleLikeBack(like)}
            activeOpacity={0.7}
          >
            <Ionicons name="heart" size={20} color={COLORS.white} />
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
          <Ionicons name="star" size={16} color={COLORS.superLike} />
          <Text style={styles.compactSectionTitle}>Super Likes</Text>
          <View style={[styles.countBadge, { backgroundColor: COLORS.superLike + '20' }]}>
            <Text style={[styles.countBadgeText, { color: COLORS.superLike }]}>{superLikeMatches.length}</Text>
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
                      <Text style={styles.compactAvatarInitial}>{item.otherUser?.name?.[0] || '?'}</Text>
                    </View>
                  )}
                </View>
                {/* Super Like star badge */}
                <View style={styles.compactSuperLikeBadge}>
                  <Ionicons name="star" size={8} color={COLORS.white} />
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
          <Ionicons name="heart-circle" size={16} color={COLORS.primary} />
          <Text style={styles.compactSectionTitle}>New Matches</Text>
          <View style={[styles.countBadge, { backgroundColor: COLORS.primary + '20' }]}>
            <Text style={[styles.countBadgeText, { color: COLORS.primary }]}>{newMatches.length}</Text>
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
              onPress={() => {
                if (item.conversationId) {
                  safePush(router, `/(main)/(tabs)/messages/chat/${item.conversationId}` as any, 'messages->newMatchChat');
                } else {
                  log.warn('[MESSAGES]', 'New Match card missing conversationId', { matchId: item.id });
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
                      <Text style={styles.compactAvatarInitial}>{item.otherUser?.name?.[0] || '?'}</Text>
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

  // Message limit UI removed — no weekly limit for now (until subscriptions added)
  const renderQuotaBanner = () => {
    return null;
  };

  // Loading state
  const isLoading = !isDemoMode && conversations === undefined;

  if (isLoading) {
    return (
      <LoadingGuard
        isLoading={true}
        onRetry={() => setRetryKey((k) => k + 1)}
        title="Loading conversations…"
        subtitle="This is taking longer than expected. Check your connection and try again."
      >
        <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
          <View style={styles.header}>
            <Text style={styles.title}>Messages</Text>
          </View>
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="small" color={COLORS.primary} />
            <Text style={styles.helperText}>Loading your conversations...</Text>
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
              <Ionicons name="arrow-back" size={24} color={COLORS.text} />
            </TouchableOpacity>
            <Text style={styles.title}>
              {pendingLikesCount} {pendingLikesCount === 1 ? 'Like' : 'Likes'}
            </Text>
            <View style={styles.headerPlaceholder} />
          </>
        ) : (
          // Messages view header
          <>
            <Text style={styles.title}>Messages</Text>
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
                  size={24}
                  color={pendingLikesCount > 0 ? COLORS.primary : COLORS.textLight}
                />
                {pendingLikesCount > 0 && (
                  <View style={styles.likesBadge}>
                    <Text style={styles.likesBadgeText}>
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
              <Ionicons name="heart-outline" size={64} color={COLORS.textLight} />
              <Text style={styles.emptyTitle}>No pending likes</Text>
              <Text style={styles.emptySubtitle}>
                When someone likes you, they'll appear here
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
        //   1. Optional sections (ProfileNudge, Super Likes, New Matches) - ONLY if they exist
        //   2. FlatList for conversations - NO ListHeaderComponent (avoids gap bug)
        //
        // Key fix: Removed ListHeaderComponent entirely. FlatList's ListHeaderComponent
        // can reserve space even when returning null, causing unwanted gaps.
        // Instead, optional sections are rendered as direct siblings ABOVE the FlatList.
        // ════════════════════════════════════════════════════════════════════════
        <View style={styles.messagesContent}>
          {/* Optional top sections - rendered ONLY when they have data */}
          {showMessagesNudge && (
            <ProfileNudge
              message={NUDGE_MESSAGES.needs_both.messages}
              onDismiss={() => dismissNudge('messages')}
            />
          )}
          {superLikeMatches.length > 0 && renderSuperLikesRow()}
          {newMatches.length > 0 && renderNewMatchesRow()}

          {/* Conversation list - starts immediately after header when no top sections */}
          <FlatList
            key="messages-list"
            style={styles.conversationList}
            data={(conversations || []) as any[]}
            keyExtractor={(item: any) => item.id}
            renderItem={({ item }: { item: any }) => (
              <ConversationItem
                id={item.id}
                otherUser={item.otherUser}
                lastMessage={item.lastMessage}
                unreadCount={item.unreadCount}
                isPreMatch={item.isPreMatch}
                onPress={() => safePush(router, `/(main)/(tabs)/messages/chat/${item.conversationId || item.id}` as any, 'messages->chat')}
                onAvatarPress={() => safePush(router, `/(main)/profile/${item.otherUser?.id}` as any, 'messages->avatarProfile')}
              />
            )}
            ListEmptyComponent={
              <View style={styles.emptyContainer}>
                <Ionicons name="chatbubbles-outline" size={64} color={COLORS.textLight} />
                <Text style={styles.emptyTitle}>No chats yet</Text>
                <Text style={styles.emptySubtitle}>
                  Match with someone or accept a confession to start chatting.
                </Text>
              </View>
            }
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
            contentContainerStyle={
              (!conversations || conversations.length === 0)
                ? styles.emptyListContainer
                : styles.conversationListContent
            }
          />
        </View>
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
              <Text style={styles.modalTitle}>It's a Match!</Text>
              <Text style={styles.modalSubtitle}>
                You and {matchedProfile?.name} liked each other
              </Text>

              <Animated.View style={[styles.modalHeart, { transform: [{ scale: heartScale }] }]}>
                <Ionicons name="heart" size={60} color={COLORS.white} />
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
                  <Text style={styles.sayHiText}>Say Hi 👋</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.keepDiscoveringButton}
                  onPress={handleKeepDiscovering}
                >
                  <Text style={styles.keepDiscoveringText}>Keep Discovering</Text>
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
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: COLORS.background,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    color: COLORS.text,
    flex: 1,
  },
  backButton: {
    marginRight: 12,
  },
  headerPlaceholder: {
    width: 40,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  likesButton: {
    padding: 8,
    borderRadius: 20,
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
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  likesBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: COLORS.white,
  },

  // Likes list
  likesListContent: {
    padding: 16,
  },
  likesColumnWrapper: {
    gap: 12,
    marginBottom: 12,
  },

  // Like Card
  likeCard: {
    flex: 1,
    maxWidth: CARD_WIDTH,
    borderRadius: 16,
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
    top: 8,
    right: 8,
    backgroundColor: COLORS.superLike,
    borderRadius: 12,
    padding: 5,
  },
  newBadge: {
    position: 'absolute',
    top: 8,
    left: 8,
    backgroundColor: COLORS.primary,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  newBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: COLORS.white,
  },
  likeCardInfo: {
    padding: 10,
    paddingBottom: 6,
  },
  likeCardName: {
    fontSize: 15,
    fontWeight: '600',
    color: COLORS.text,
  },
  likeCardTime: {
    fontSize: 12,
    color: COLORS.textLight,
    marginTop: 2,
  },
  // Standout message display
  standoutMessageContainer: {
    paddingHorizontal: 10,
    paddingBottom: 8,
  },
  standoutMessageText: {
    fontSize: 12,
    fontStyle: 'italic',
    color: COLORS.superLike,
    lineHeight: 16,
  },
  likeCardActions: {
    flexDirection: 'row',
    paddingHorizontal: 10,
    paddingBottom: 10,
    gap: 10,
  },
  passButton: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 40,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: '#F44336',
    backgroundColor: COLORS.background,
  },
  likeBackButton: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 40,
    borderRadius: 10,
    backgroundColor: COLORS.primary,
  },

  // Likes Preview (compact row in messages view)
  likesPreview: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    marginHorizontal: 16,
    marginTop: 12,
    backgroundColor: COLORS.primary + '10',
    borderRadius: 12,
    gap: 12,
  },
  likesPreviewLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    gap: 8,
  },
  likesPreviewText: {
    fontSize: 15,
    fontWeight: '600',
    color: COLORS.primary,
  },
  likesPreviewAvatars: {
    flexDirection: 'row',
  },
  likesPreviewAvatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 2,
    borderColor: COLORS.background,
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // COMPACT SECTIONS - Super Likes & New Matches (responsive spacing)
  // ═══════════════════════════════════════════════════════════════════════════

  // Super Likes section (compact)
  superLikesSection: {
    paddingTop: SPACING.sectionTop,
    paddingBottom: 0,
  },

  // New Matches Section (compact)
  newMatchesSection: {
    paddingTop: SPACING.sectionGap,
    paddingBottom: SPACING.sectionGap,
  },

  // Compact section header (shared)
  compactSectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    marginBottom: SPACING.titleToRow,
    gap: 6,
  },
  compactSectionTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.text,
  },

  // Compact avatar list
  compactMatchesList: {
    paddingLeft: 16,
    paddingRight: 16,
  },
  compactMatchItem: {
    marginRight: SPACING.avatarGap,
    alignItems: 'center',
  },
  compactAvatarContainer: {
    position: 'relative',
  },
  compactMatchRing: {
    width: SPACING.avatarSize + 8,
    height: SPACING.avatarSize + 8,
    borderRadius: (SPACING.avatarSize + 8) / 2,
    borderWidth: 2,
    borderColor: COLORS.primary,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 2,
  },
  compactMatchAvatar: {
    width: SPACING.avatarSize,
    height: SPACING.avatarSize,
    borderRadius: SPACING.avatarSize / 2,
    backgroundColor: COLORS.backgroundDark,
  },
  compactAvatarInitial: {
    fontSize: 18,
    fontWeight: '600',
    color: COLORS.text,
  },

  // Compact Super Like badge
  compactSuperLikeBadge: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    backgroundColor: COLORS.superLike,
    width: 16,
    height: 16,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: COLORS.background,
  },

  // Legacy styles (kept for compatibility)
  matchesList: {
    paddingLeft: 16,
    paddingRight: 24,
  },
  matchItem: {
    marginRight: 16,
    alignItems: 'center',
    width: 72,
  },
  matchAvatarContainer: {
    marginBottom: 6,
  },
  matchRing: {
    width: 68,
    height: 68,
    borderRadius: 34,
    borderWidth: 2.5,
    borderColor: COLORS.primary,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 2,
  },
  matchAvatar: {
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: COLORS.backgroundDark,
  },
  matchName: {
    fontSize: 12,
    color: COLORS.text,
    fontWeight: '500',
    textAlign: 'center',
  },
  // Super Like badge on match avatar
  superLikeMatchBadge: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    backgroundColor: COLORS.superLike,
    width: 18,
    height: 18,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: COLORS.background,
  },

  // Section headers
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    marginBottom: 12,
    gap: 8,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.text,
  },
  countBadge: {
    backgroundColor: COLORS.superLike + '20',
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 8,
  },
  countBadgeText: {
    fontSize: 11,
    fontWeight: '600',
    color: COLORS.superLike,
  },
  threadsSectionHeader: {
    paddingHorizontal: 16,
    paddingTop: SPACING.beforeMessages,
    paddingBottom: 6,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
    marginTop: SPACING.sectionGap,
  },

  // Quota banner
  quotaBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.warning + '20',
    padding: 12,
    paddingHorizontal: 16,
    marginHorizontal: 16,
    marginTop: 8,
    borderRadius: 8,
  },
  quotaBannerActive: {
    backgroundColor: COLORS.primary + '20',
  },
  quotaContent: {
    flex: 1,
    marginLeft: 12,
  },
  quotaTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.text,
  },
  quotaSubtitle: {
    fontSize: 12,
    color: COLORS.textLight,
    marginTop: 2,
  },
  quotaText: {
    fontSize: 14,
    color: COLORS.primary,
    marginLeft: 12,
    fontWeight: '500',
  },
  upgradeButton: {
    backgroundColor: COLORS.primary,
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderRadius: 16,
  },
  upgradeButtonText: {
    color: COLORS.white,
    fontSize: 12,
    fontWeight: '600',
  },

  // Placeholder avatar
  placeholderAvatar: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitial: {
    fontSize: 22,
    fontWeight: '600',
    color: COLORS.text,
  },

  // Loading
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
    gap: 12,
  },
  helperText: {
    fontSize: 14,
    color: COLORS.textLight,
    textAlign: 'center',
  },

  // Empty states
  emptyContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 40,
  },
  emptyListContainer: {
    flexGrow: 1,
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: COLORS.text,
    marginTop: 16,
    marginBottom: 8,
  },
  emptySubtitle: {
    fontSize: 14,
    color: COLORS.textLight,
    textAlign: 'center',
    lineHeight: 20,
  },

  // Match Modal
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalContent: {
    width: SCREEN_WIDTH - 48,
    borderRadius: 24,
    overflow: 'hidden',
  },
  modalGradient: {
    padding: 24,
    alignItems: 'center',
  },
  modalTitle: {
    fontSize: 32,
    fontWeight: '700',
    color: COLORS.white,
    marginBottom: 8,
  },
  modalSubtitle: {
    fontSize: 16,
    color: COLORS.white,
    opacity: 0.9,
    marginBottom: 24,
    textAlign: 'center',
  },
  modalHeart: {
    marginBottom: 24,
  },
  modalPhoto: {
    width: 100,
    height: 100,
    borderRadius: 50,
    borderWidth: 4,
    borderColor: COLORS.white,
    marginBottom: 24,
  },
  modalActions: {
    width: '100%',
    gap: 12,
  },
  sayHiButton: {
    backgroundColor: COLORS.white,
    paddingVertical: 14,
    borderRadius: 30,
    alignItems: 'center',
  },
  sayHiText: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.primary,
  },
  keepDiscoveringButton: {
    paddingVertical: 14,
    alignItems: 'center',
  },
  keepDiscoveringText: {
    fontSize: 16,
    fontWeight: '500',
    color: COLORS.white,
  },
});
