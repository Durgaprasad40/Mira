import React, { useState, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '@/lib/constants';
import { ConfessionMood, ConfessionSortBy } from '@/types';
import { useAuthStore } from '@/stores/authStore';
import { isDemoMode } from '@/hooks/useConvex';
import {
  DEMO_CONFESSIONS,
  DEMO_CONFESSION_USER_REACTIONS,
} from '@/lib/demoData';
import ConfessionCard from '@/components/confessions/ConfessionCard';
import ComposeConfessionModal from '@/components/confessions/ComposeConfessionModal';

export default function ConfessionsScreen() {
  const router = useRouter();
  const { userId } = useAuthStore();
  const [sortBy, setSortBy] = useState<ConfessionSortBy>('trending');
  const [refreshing, setRefreshing] = useState(false);
  const [showCompose, setShowCompose] = useState(false);

  // Demo state
  const [demoConfessions, setDemoConfessions] = useState(DEMO_CONFESSIONS);
  const [demoReactions, setDemoReactions] = useState(DEMO_CONFESSION_USER_REACTIONS);

  const sortedConfessions = useMemo(() => {
    const list = [...demoConfessions];
    if (sortBy === 'trending') {
      list.sort((a, b) => {
        const scoreA = a.replyCount * 2 + a.reactionCount;
        const scoreB = b.replyCount * 2 + b.reactionCount;
        return scoreB - scoreA;
      });
    } else {
      list.sort((a, b) => b.createdAt - a.createdAt);
    }
    return list;
  }, [demoConfessions, sortBy]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    setTimeout(() => setRefreshing(false), 800);
  }, []);

  const handleReact = useCallback((confessionId: string) => {
    setDemoReactions((prev) => {
      const next = { ...prev };
      if (next[confessionId]) {
        delete next[confessionId];
      } else {
        next[confessionId] = true;
      }
      return next;
    });
    setDemoConfessions((prev) =>
      prev.map((c) => {
        if (c.id !== confessionId) return c;
        const wasReacted = demoReactions[confessionId];
        return {
          ...c,
          reactionCount: wasReacted
            ? Math.max(0, c.reactionCount - 1)
            : c.reactionCount + 1,
        };
      })
    );
  }, [demoReactions]);

  const handleCompose = useCallback(
    (text: string, isAnonymous: boolean, mood: ConfessionMood) => {
      const newConfession = {
        id: `conf_new_${Date.now()}`,
        userId: userId || 'demo_user_1',
        text,
        isAnonymous,
        mood,
        visibility: 'global' as const,
        replyCount: 0,
        reactionCount: 0,
        createdAt: Date.now(),
      };
      setDemoConfessions((prev) => [newConfession, ...prev]);
      setShowCompose(false);
    },
    [userId]
  );

  const handleOpenThread = useCallback(
    (confessionId: string) => {
      router.push({
        pathname: '/(main)/confession-thread',
        params: { confessionId },
      } as any);
    },
    [router]
  );

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Confessions</Text>
        <TouchableOpacity
          style={styles.composeButton}
          onPress={() => setShowCompose(true)}
        >
          <Ionicons name="add" size={22} color={COLORS.white} />
        </TouchableOpacity>
      </View>

      {/* Sort Toggle */}
      <View style={styles.sortRow}>
        {(['trending', 'latest'] as ConfessionSortBy[]).map((option) => (
          <TouchableOpacity
            key={option}
            style={[styles.sortChip, sortBy === option && styles.sortChipActive]}
            onPress={() => setSortBy(option)}
          >
            <Ionicons
              name={option === 'trending' ? 'trending-up' : 'time'}
              size={16}
              color={sortBy === option ? COLORS.white : COLORS.textLight}
            />
            <Text
              style={[
                styles.sortLabel,
                sortBy === option && styles.sortLabelActive,
              ]}
            >
              {option === 'trending' ? 'Trending' : 'Latest'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Feed */}
      <FlatList
        data={sortedConfessions}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <ConfessionCard
            id={item.id}
            text={item.text}
            isAnonymous={item.isAnonymous}
            mood={item.mood}
            replyCount={item.replyCount}
            reactionCount={item.reactionCount}
            createdAt={item.createdAt}
            hasReacted={!!demoReactions[item.id]}
            onPress={() => handleOpenThread(item.id)}
            onReact={() => handleReact(item.id)}
          />
        )}
        contentContainerStyle={styles.listContent}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.primary} />
        }
        showsVerticalScrollIndicator={false}
      />

      {/* Compose Modal */}
      <ComposeConfessionModal
        visible={showCompose}
        onClose={() => setShowCompose(false)}
        onSubmit={handleCompose}
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
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 8,
  },
  headerTitle: {
    fontSize: 28,
    fontWeight: '800',
    color: COLORS.text,
  },
  composeButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: COLORS.primary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  sortRow: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingBottom: 12,
    gap: 8,
  },
  sortChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: COLORS.white,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  sortChipActive: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },
  sortLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.textLight,
  },
  sortLabelActive: {
    color: COLORS.white,
  },
  listContent: {
    paddingTop: 4,
    paddingBottom: 100,
  },
});
