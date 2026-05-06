import React, { useMemo, useState, useCallback } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useQuery, useMutation } from 'convex/react';
import { Ionicons } from '@expo/vector-icons';

import { api } from '@/convex/_generated/api';
import { COLORS } from '@/lib/constants';
import { isDemoMode } from '@/hooks/useConvex';
import { useAuthStore } from '@/stores/authStore';
import { useConfessionStore } from '@/stores/confessionStore';
import { safePush } from '@/lib/safeRouter';
import ConfessionCard from '@/components/confessions/ConfessionCard';
import { ConfessionMenuSheet } from '@/components/confessions/ConfessionMenuSheet';
import ConfessionUnderReviewBadge, {
  type ConfessionModerationStatus,
} from '@/components/confessions/ConfessionUnderReviewBadge';

function formatAbsoluteDate(timestamp: number | undefined): string | undefined {
  if (timestamp === undefined || !Number.isFinite(timestamp)) return undefined;
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(new Date(timestamp));
}

function formatExpiredDateLabel(timestamp: number | undefined): string | undefined {
  const dateLabel = formatAbsoluteDate(timestamp);
  return dateLabel ? `Expired on ${dateLabel}` : undefined;
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

export default function MyConfessionsScreen() {
  const router = useRouter();
  const userId = useAuthStore((s) => s.userId);
  const currentUserId = isDemoMode ? (userId || 'demo_user_1') : userId;

  const demoConfessions = useConfessionStore((s) => s.confessions);
  const demoUserReactions = useConfessionStore((s) => s.userReactions);
  const demoDeleteConfession = useConfessionStore((s) => s.deleteConfession);

  // Convex current user for effectiveViewerId
  const convexCurrentUser = useQuery(
    api.users.getCurrentUser,
    !isDemoMode && currentUserId ? { userId: currentUserId } : 'skip'
  );
  const effectiveViewerId = isDemoMode ? currentUserId : convexCurrentUser?._id;

  // Delete mutation
  const deleteConfessionMutation = useMutation(api.confessions.deleteConfession);

  // Menu state
  const [showMenuSheet, setShowMenuSheet] = useState(false);
  const [menuTargetConfession, setMenuTargetConfession] = useState<{ id: string; authorId: string } | null>(null);

  const liveMyConfessions = useQuery(
    api.confessions.getMyConfessions,
    !isDemoMode && currentUserId ? { userId: currentUserId } : 'skip'
  );

  const myConfessions = useMemo(() => {
    if (!isDemoMode) {
      return (liveMyConfessions ?? []).map((confession: any) => ({
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
        replyCount: confession.replyCount ?? 0,
        reactionCount: confession.reactionCount ?? 0,
        createdAt: confession.createdAt,
        expiresAt: confession.expiresAt,
        isExpired: confession.isExpired === true,
        moderationStatus: confession.moderationStatus,
        isUnderReview: confession.isUnderReview === true,
      }));
    }

    const now = Date.now();
    return demoConfessions
      .filter((confession: any) => confession.userId === currentUserId)
      .filter((confession: any) => !confession.isDeleted) // Exclude manually deleted
      .sort((a: any, b: any) => b.createdAt - a.createdAt)
      .map((confession: any) => ({
        id: confession.id,
        userId: confession.userId,
        text: confession.text,
        isAnonymous: confession.isAnonymous,
        authorVisibility: confession.authorVisibility,
        mood: confession.mood,
        authorName: confession.authorName,
        authorPhotoUrl: confession.authorPhotoUrl,
        authorAge: confession.authorAge,
        authorGender: confession.authorGender,
        replyCount: confession.replyCount ?? 0,
        reactionCount: confession.reactionCount ?? 0,
        createdAt: confession.createdAt,
        expiresAt: confession.expiresAt ?? confession.createdAt + 24 * 60 * 60 * 1000,
        isExpired: (confession.expiresAt ?? confession.createdAt + 24 * 60 * 60 * 1000) <= now,
      }));
  }, [currentUserId, demoConfessions, liveMyConfessions]);

  const isLoading = !isDemoMode && liveMyConfessions === undefined;

  // Handlers
  const handleOpenThread = useCallback((confessionId: string) => {
    safePush(
      router,
      { pathname: '/(main)/confession-thread', params: { confessionId } } as any,
      'myConfessions->thread'
    );
  }, [router]);

  const handleOpenMenuSheet = useCallback((confessionId: string, authorId: string) => {
    setMenuTargetConfession({ id: confessionId, authorId });
    setShowMenuSheet(true);
  }, []);

  const handleCloseMenuSheet = useCallback(() => {
    setShowMenuSheet(false);
    setMenuTargetConfession(null);
  }, []);

  const handleMenuEdit = useCallback(() => {
    if (!menuTargetConfession) return;
    safePush(
      router,
      {
        pathname: '/(main)/compose-confession',
        params: { editId: menuTargetConfession.id, mode: 'edit' },
      } as any,
      'myConfessions->editConfession'
    );
  }, [menuTargetConfession, router]);

  const handleMenuDelete = useCallback(() => {
    if (!menuTargetConfession) return;
    Alert.alert(
      'Delete Confession',
      'Are you sure you want to delete this confession? This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              if (isDemoMode) {
                demoDeleteConfession(menuTargetConfession.id);
              } else {
                await deleteConfessionMutation({
                  confessionId: menuTargetConfession.id as any,
                  userId: currentUserId!,
                });
              }
            } catch (error: any) {
              Alert.alert('Error', error?.message || 'Failed to delete confession');
            }
          },
        },
      ]
    );
  }, [menuTargetConfession, currentUserId, deleteConfessionMutation, demoDeleteConfession]);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => router.back()}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Ionicons name="chevron-back" size={24} color={COLORS.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>My Confessions</Text>
        <View style={{ width: 24 }} />
      </View>

      <Text style={styles.hint}>
        Expired confessions are hidden from the public feed but still kept here.
      </Text>

      <FlatList
        data={myConfessions}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        renderItem={({ item }) => {
          const reviewStatus = getReviewBadgeStatus(item);

          return (
            <View>
              {reviewStatus ? (
                <View style={styles.reviewBadgeWrap}>
                  <ConfessionUnderReviewBadge status={reviewStatus} />
                </View>
              ) : null}
              <ConfessionCard
                id={item.id}
                text={item.text}
                isAnonymous={item.isAnonymous}
                authorVisibility={item.authorVisibility}
                mood={item.mood}
                topEmojis={[]}
                userEmoji={isDemoMode ? (demoUserReactions[item.id] ?? null) : null}
                replyPreviews={[]}
                replyCount={item.replyCount}
                reactionCount={item.reactionCount}
                authorName={item.authorName}
                authorPhotoUrl={item.authorPhotoUrl}
                authorAge={item.authorAge}
                authorGender={item.authorGender}
                createdAt={item.createdAt}
                isExpired={item.isExpired}
                expiredDateLabel={item.isExpired ? formatExpiredDateLabel(item.expiresAt) : undefined}
                reactionsReadOnly={item.isExpired}
                authorId={item.userId}
                viewerId={effectiveViewerId ?? undefined}
                // EXPLICIT INTERACTION CONTRACT for My Confessions
                // Owner can tap to view thread and long-press to edit/delete
                screenContext="my-confessions"
                enableTapToOpenThread={true}
                enableLongPressMenu={true}
                onCardPress={() => handleOpenThread(item.id)}
                onCardLongPress={() => handleOpenMenuSheet(item.id, item.userId)}
                onReact={() => {}}
              />
            </View>
          );
        }}
        ListEmptyComponent={
          isLoading ? (
            <View style={styles.loadingState}>
              <ActivityIndicator size="large" color={COLORS.primary} />
              <Text style={styles.loadingText}>Loading...</Text>
            </View>
          ) : (
            <View style={styles.emptyState}>
              <Text style={styles.emptyEmoji}>📝</Text>
              <Text style={styles.emptyTitle}>No confessions yet</Text>
              <Text style={styles.emptySubtitle}>
                Your confessions will appear here after you post them.
              </Text>
              <TouchableOpacity
                style={styles.emptyButton}
                onPress={() => safePush(router, '/(main)/compose-confession' as any, 'myConfessions->compose')}
              >
                <Text style={styles.emptyButtonText}>Post a Confession</Text>
              </TouchableOpacity>
            </View>
          )
        }
      />

      {/* Owner menu sheet for edit/delete */}
      <ConfessionMenuSheet
        visible={showMenuSheet}
        isOwner={true}
        onClose={handleCloseMenuSheet}
        onEdit={handleMenuEdit}
        onDelete={handleMenuDelete}
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
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.border,
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: COLORS.text,
  },
  hint: {
    fontSize: 12,
    color: COLORS.textLight,
    textAlign: 'center',
    paddingHorizontal: 24,
    paddingVertical: 10,
  },
  listContent: {
    paddingTop: 4,
    paddingBottom: 40,
  },
  reviewBadgeWrap: {
    marginHorizontal: 14,
    marginTop: 6,
    marginBottom: -2,
    alignItems: 'flex-start',
  },
  loadingState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 80,
    gap: 12,
  },
  loadingText: {
    fontSize: 16,
    color: COLORS.textLight,
  },
  emptyState: {
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
});
