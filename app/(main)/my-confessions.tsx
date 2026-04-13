import React, { useMemo } from 'react';
import {
  ActivityIndicator,
  FlatList,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useQuery } from 'convex/react';
import { Ionicons } from '@expo/vector-icons';

import { api } from '@/convex/_generated/api';
import { COLORS } from '@/lib/constants';
import { isDemoMode } from '@/hooks/useConvex';
import { useAuthStore } from '@/stores/authStore';
import { useConfessionStore } from '@/stores/confessionStore';
import { safePush } from '@/lib/safeRouter';
import ConfessionCard from '@/components/confessions/ConfessionCard';

export default function MyConfessionsScreen() {
  const router = useRouter();
  const userId = useAuthStore((s) => s.userId);
  const currentUserId = isDemoMode ? (userId || 'demo_user_1') : userId;

  const demoConfessions = useConfessionStore((s) => s.confessions);
  const demoUserReactions = useConfessionStore((s) => s.userReactions);

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
        mood: confession.mood,
        authorName: confession.authorName,
        authorPhotoUrl: confession.authorPhotoUrl,
        replyCount: confession.replyCount ?? 0,
        reactionCount: confession.reactionCount ?? 0,
        createdAt: confession.createdAt,
        isExpired: confession.isExpired === true,
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
        mood: confession.mood,
        authorName: confession.authorName,
        authorPhotoUrl: confession.authorPhotoUrl,
        replyCount: confession.replyCount ?? 0,
        reactionCount: confession.reactionCount ?? 0,
        createdAt: confession.createdAt,
        isExpired: (confession.expiresAt ?? confession.createdAt + 24 * 60 * 60 * 1000) <= now,
      }));
  }, [currentUserId, demoConfessions, liveMyConfessions]);

  const isLoading = !isDemoMode && liveMyConfessions === undefined;

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
        renderItem={({ item }) => (
          <ConfessionCard
            id={item.id}
            text={item.text}
            isAnonymous={item.isAnonymous}
            mood={item.mood}
            topEmojis={[]}
            userEmoji={isDemoMode ? (demoUserReactions[item.id] ?? null) : null}
            replyPreviews={[]}
            replyCount={item.replyCount}
            reactionCount={item.reactionCount}
            authorName={item.authorName}
            authorPhotoUrl={item.authorPhotoUrl}
            createdAt={item.createdAt}
            isExpired={item.isExpired}
            // EXPLICIT INTERACTION CONTRACT for My Confessions (/my-confessions)
            // This is a READ-ONLY archive screen - NO tap navigation, NO long-press menu
            // P0 FIX: Disabled tap-to-thread to prevent app crash on Android
            screenContext="my-confessions"
            enableTapToOpenThread={false}
            enableLongPressMenu={false}
            onCardPress={() => {
              // Tap is disabled - this is a read-only archive view
              console.log('[MY_CONFESSIONS_TAP] Card tapped (read-only mode), id:', item?.id);
            }}
            onReact={() => {}}
          />
        )}
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
