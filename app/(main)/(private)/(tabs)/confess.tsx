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
import { INCOGNITO_COLORS } from '@/lib/constants';
import { ConfessionMood, ConfessionSortBy } from '@/types';
import { useAuthStore } from '@/stores/authStore';
import {
  DEMO_CONFESSIONS,
  DEMO_CONFESSION_USER_REACTIONS,
} from '@/lib/demoData';
import ComposeConfessionModal from '@/components/confessions/ComposeConfessionModal';

const C = INCOGNITO_COLORS;

const MOOD_CONFIG: Record<ConfessionMood, { emoji: string; label: string; color: string; bg: string }> = {
  romantic: { emoji: '\u2764\uFE0F', label: 'Romantic', color: '#E91E63', bg: 'rgba(233,30,99,0.15)' },
  spicy: { emoji: '\uD83D\uDD25', label: 'Spicy', color: '#FF5722', bg: 'rgba(255,87,34,0.15)' },
  emotional: { emoji: '\uD83D\uDE22', label: 'Emotional', color: '#64B5F6', bg: 'rgba(100,181,246,0.15)' },
  funny: { emoji: '\uD83D\uDE02', label: 'Funny', color: '#FFB74D', bg: 'rgba(255,183,77,0.15)' },
};

function getTimeAgo(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export default function PrivateConfessScreen() {
  const router = useRouter();
  const { userId } = useAuthStore();
  const [sortBy, setSortBy] = useState<ConfessionSortBy>('trending');
  const [refreshing, setRefreshing] = useState(false);
  const [showCompose, setShowCompose] = useState(false);

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

  const renderCard = useCallback(({ item }: { item: typeof demoConfessions[0] }) => {
    const moodInfo = MOOD_CONFIG[item.mood];
    const hasReacted = !!demoReactions[item.id];

    return (
      <TouchableOpacity
        style={styles.card}
        onPress={() => handleOpenThread(item.id)}
        activeOpacity={0.7}
      >
        <View style={styles.cardHeader}>
          <View style={styles.authorRow}>
            <View style={[styles.avatar, item.isAnonymous && styles.avatarAnonymous]}>
              <Ionicons
                name={item.isAnonymous ? 'eye-off' : 'person'}
                size={14}
                color={item.isAnonymous ? C.textLight : C.primary}
              />
            </View>
            <Text style={styles.authorName}>
              {item.isAnonymous ? 'Anonymous' : 'Someone'}
            </Text>
            <Text style={styles.timeAgo}>{getTimeAgo(item.createdAt)}</Text>
          </View>
          <View style={[styles.moodBadge, { backgroundColor: moodInfo.bg }]}>
            <Text style={styles.moodEmoji}>{moodInfo.emoji}</Text>
            <Text style={[styles.moodLabel, { color: moodInfo.color }]}>{moodInfo.label}</Text>
          </View>
        </View>

        <Text style={styles.confessionText} numberOfLines={4}>{item.text}</Text>

        <View style={styles.cardFooter}>
          <TouchableOpacity
            style={styles.footerBtn}
            onPress={() => handleReact(item.id)}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Ionicons
              name={hasReacted ? 'heart' : 'heart-outline'}
              size={20}
              color={hasReacted ? C.primary : C.textLight}
            />
            <Text style={[styles.footerCount, hasReacted && { color: C.primary }]}>
              {item.reactionCount}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.footerBtn} onPress={() => handleOpenThread(item.id)}>
            <Ionicons name="chatbubble-outline" size={18} color={C.textLight} />
            <Text style={styles.footerCount}>{item.replyCount}</Text>
          </TouchableOpacity>
        </View>
      </TouchableOpacity>
    );
  }, [demoReactions, handleOpenThread, handleReact]);

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Confess</Text>
        <TouchableOpacity
          style={styles.composeButton}
          onPress={() => setShowCompose(true)}
        >
          <Ionicons name="add" size={22} color="#FFFFFF" />
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
              color={sortBy === option ? '#FFFFFF' : C.textLight}
            />
            <Text
              style={[styles.sortLabel, sortBy === option && styles.sortLabelActive]}
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
        renderItem={renderCard}
        contentContainerStyle={styles.listContent}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.primary} />
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
    backgroundColor: C.background,
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
    color: C.text,
  },
  composeButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: C.primary,
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
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.accent,
  },
  sortChipActive: {
    backgroundColor: C.primary,
    borderColor: C.primary,
  },
  sortLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: C.textLight,
  },
  sortLabelActive: {
    color: '#FFFFFF',
  },
  listContent: {
    paddingTop: 4,
    paddingBottom: 100,
  },
  card: {
    backgroundColor: C.surface,
    borderRadius: 16,
    padding: 16,
    marginHorizontal: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: C.accent,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  authorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  avatar: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: 'rgba(233,69,96,0.15)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarAnonymous: {
    backgroundColor: 'rgba(158,158,158,0.15)',
  },
  authorName: {
    fontSize: 14,
    fontWeight: '600',
    color: C.text,
  },
  timeAgo: {
    fontSize: 12,
    color: C.textLight,
  },
  moodBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    gap: 4,
  },
  moodEmoji: {
    fontSize: 12,
  },
  moodLabel: {
    fontSize: 11,
    fontWeight: '600',
  },
  confessionText: {
    fontSize: 15,
    lineHeight: 22,
    color: C.text,
    marginBottom: 14,
  },
  cardFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 20,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: C.accent,
    paddingTop: 12,
  },
  footerBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  footerCount: {
    fontSize: 13,
    color: C.textLight,
    fontWeight: '500',
  },
});
