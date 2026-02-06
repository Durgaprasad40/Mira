import React, { useMemo } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { COLORS } from '@/lib/constants';
import { useAuthStore } from '@/stores/authStore';
import { useConfessionStore } from '@/stores/confessionStore';
import { isDemoMode } from '@/hooks/useConvex';
import { asUserId } from '@/convex/id';
import { ConfessionMood } from '@/types';
import ConfessionCard from '@/components/confessions/ConfessionCard';

export default function MyConfessionsScreen() {
  const router = useRouter();
  const userId = useAuthStore((s) => s.userId);
  const currentUserId = userId || 'demo_user_1';

  // Demo store
  const demoConfessions = useConfessionStore((s) => s.confessions);
  const userReactions = useConfessionStore((s) => s.userReactions);

  // Convex query (only when not in demo mode)
  const convexUserId = asUserId(currentUserId);
  const convexMyConfessions = useQuery(
    api.confessions.getMyConfessions,
    !isDemoMode && convexUserId ? { userId: convexUserId } : 'skip'
  );

  // Unified confession type for the list
  type MyConfession = {
    id: string;
    text: string;
    isAnonymous: boolean;
    mood: ConfessionMood;
    authorName?: string;
    authorPhotoUrl?: string;
    replyCount: number;
    reactionCount: number;
    createdAt: number;
    isExpired: boolean;
  };

  // Merge data
  const myConfessions = useMemo((): MyConfession[] => {
    if (!isDemoMode && convexMyConfessions) {
      return convexMyConfessions.map((c: any) => ({
        id: c._id,
        text: c.text,
        isAnonymous: c.isAnonymous,
        mood: c.mood,
        authorName: c.authorName,
        authorPhotoUrl: c.authorPhotoUrl,
        replyCount: c.replyCount,
        reactionCount: c.reactionCount,
        createdAt: c.createdAt,
        isExpired: c.isExpired,
      }));
    }
    // Demo mode: filter to current user's confessions and add isExpired flag
    const now = Date.now();
    const EXPIRY_MS = 24 * 60 * 60 * 1000;
    return demoConfessions
      .filter((c) => c.userId === currentUserId)
      .map((c) => ({
        id: c.id,
        text: c.text,
        isAnonymous: c.isAnonymous,
        mood: c.mood,
        authorName: c.authorName,
        authorPhotoUrl: c.authorPhotoUrl,
        replyCount: c.replyCount,
        reactionCount: c.reactionCount,
        createdAt: c.createdAt,
        isExpired: c.createdAt + EXPIRY_MS < now,
      }))
      .sort((a, b) => b.createdAt - a.createdAt);
  }, [isDemoMode, convexMyConfessions, demoConfessions, currentUserId]);

  const isLoading = !isDemoMode && convexMyConfessions === undefined;

  const handleOpenThread = (confessionId: string) => {
    router.push({
      pathname: '/(main)/confession-thread',
      params: { confessionId },
    } as any);
  };

  const handleOpenCompose = () => {
    router.push('/(main)/compose-confession' as any);
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Header */}
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

      {/* Hint */}
      <Text style={styles.hint}>
        Expired confessions are hidden from the public feed but saved here forever.
      </Text>

      {/* List */}
      <FlatList
        data={myConfessions}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <ConfessionCard
            id={item.id}
            text={item.text}
            isAnonymous={item.isAnonymous}
            mood={item.mood}
            topEmojis={[]}
            userEmoji={userReactions[item.id] || null}
            replyPreviews={[]}
            replyCount={item.replyCount}
            reactionCount={item.reactionCount}
            authorName={item.authorName}
            createdAt={item.createdAt}
            isExpired={item.isExpired}
            onPress={() => handleOpenThread(item.id)}
            onReact={() => {}}
          />
        )}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={
          isLoading ? (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="large" color={COLORS.primary} />
              <Text style={styles.loadingText}>Loading...</Text>
            </View>
          ) : (
            <View style={styles.emptyContainer}>
              <Text style={styles.emptyEmoji}>📝</Text>
              <Text style={styles.emptyTitle}>No confessions yet</Text>
              <Text style={styles.emptySubtitle}>
                Your confessions will appear here after you post them.
              </Text>
              <TouchableOpacity style={styles.emptyButton} onPress={handleOpenCompose}>
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
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingTop: 80,
    gap: 12,
  },
  loadingText: {
    fontSize: 16,
    color: COLORS.textLight,
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
});
