import React, { useCallback, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  RefreshControl, ActivityIndicator,
} from 'react-native';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { INCOGNITO_COLORS } from '@/lib/constants';
import { useAuthStore } from '@/stores/authStore';

const C = INCOGNITO_COLORS;

// Gender icon helper
function getGenderIcon(gender?: string): keyof typeof Ionicons.glyphMap {
  if (!gender) return 'male-female';
  const g = gender.toLowerCase();
  if (g === 'male') return 'male';
  if (g === 'female') return 'female';
  return 'male-female';
}

/* ─── Compact Comment Preview Row ─── */
function CommentPreviewRow({ answer }: { answer: any }) {
  const isMedia = answer.type === 'photo' || answer.type === 'video' || answer.type === 'voice';
  const displayName = answer.isAnonymous !== false ? 'Anonymous' : (answer.authorName || 'User');

  return (
    <View style={styles.commentRow}>
      <View style={styles.commentAvatar}>
        <Ionicons name="person" size={10} color={C.textLight} />
      </View>
      <Text style={styles.commentText} numberOfLines={1} ellipsizeMode="tail">
        <Text style={styles.commentName}>{displayName}</Text>
        {'  '}
        {isMedia ? (
          <Text style={styles.commentMedia}>
            {answer.type === 'voice' ? '🎤 Voice' : answer.type === 'video' ? '🎬 Video' : '📷 Photo'}
          </Text>
        ) : (
          <Text style={styles.commentSnippet}>{answer.text || ''}</Text>
        )}
      </Text>
    </View>
  );
}

/* ─── Trending Prompt Data Type ─── */
type TrendingPromptData = {
  _id: any;
  type: 'truth' | 'dare';
  text: string;
  isTrending: boolean;
  expiresAt: number;
  answerCount: number;
  isAnonymous?: boolean;
  ownerName?: string;
  ownerPhotoUrl?: string;
  ownerAge?: number;
  ownerGender?: string;
};

/* ─── Trending Card (compact, no previews, "X answers" only) ─── */
function TrendingCard({
  prompt,
  onOpenThread,
  onAddComment,
}: {
  prompt: TrendingPromptData;
  onOpenThread: () => void;
  onAddComment: () => void;
}) {
  const isTruth = prompt.type === 'truth';
  const isAnon = prompt.isAnonymous ?? true;
  const answerCount = prompt.answerCount ?? 0;

  return (
    <TouchableOpacity style={styles.card} onPress={onOpenThread} activeOpacity={0.7}>
      {/* Card content wrapper */}
      <View style={styles.cardContent}>
        {/* Header Row: LEFT = Identity, RIGHT = Type pill */}
        <View style={styles.cardHeader}>
          {/* LEFT: Owner Identity */}
          <View style={styles.ownerIdentity}>
            {!isAnon && prompt.ownerPhotoUrl ? (
              <Image source={{ uri: prompt.ownerPhotoUrl }} style={styles.ownerPhoto} />
            ) : (
              <View style={styles.ownerPhotoPlaceholder}>
                <Ionicons name={isAnon ? 'eye-off' : 'person'} size={12} color={C.textLight} />
              </View>
            )}
            <View style={styles.ownerInfo}>
              <Text style={styles.ownerName} numberOfLines={1}>
                {isAnon ? 'Anonymous' : (prompt.ownerName || 'User')}
                {prompt.ownerAge ? `, ${prompt.ownerAge}` : ''}
              </Text>
              {prompt.ownerGender && (
                <Ionicons name={getGenderIcon(prompt.ownerGender)} size={11} color={C.textLight} />
              )}
            </View>
          </View>

          {/* RIGHT: Type pill */}
          <View style={[styles.typePill, { backgroundColor: isTruth ? '#6C5CE7' : '#E17055' }]}>
            <Ionicons name={isTruth ? 'help-circle' : 'flash'} size={10} color="#FFF" />
            <Text style={styles.typePillText}>{isTruth ? 'Truth' : 'Dare'}</Text>
          </View>
        </View>

        {/* Prompt text */}
        <Text style={styles.promptText} numberOfLines={3}>{prompt.text}</Text>

        {/* Footer: +N more */}
        <View style={styles.cardFooter}>
          <Text style={styles.moreCountLabel}>+{answerCount} more</Text>
        </View>
      </View>

      {/* Big + button on right side */}
      <TouchableOpacity
        style={styles.addButton}
        onPress={(e) => { e.stopPropagation(); onAddComment(); }}
        activeOpacity={0.8}
      >
        <Ionicons name="add" size={22} color="#FFF" />
      </TouchableOpacity>
    </TouchableOpacity>
  );
}

/* ─── Prompt Card (with comment previews) ─── */
function PromptCard({
  prompt,
  onOpenThread,
  onAddComment,
}: {
  prompt: {
    _id: any;
    type: 'truth' | 'dare';
    text: string;
    isTrending: boolean;
    expiresAt: number;
    top2Answers: any[];
    totalAnswers: number;
    hasAnswered: boolean;
    myAnswerId: string | null;
    isAnonymous?: boolean;
    ownerName?: string;
    ownerPhotoUrl?: string;
    ownerAge?: number;
    ownerGender?: string;
    answerCount?: number;
  };
  onOpenThread: () => void;
  onAddComment: () => void;
}) {
  const isTruth = prompt.type === 'truth';
  const isAnon = prompt.isAnonymous ?? true;
  const answerCount = prompt.totalAnswers ?? prompt.answerCount ?? 0;
  const previewCount = prompt.top2Answers?.length ?? 0;

  return (
    <TouchableOpacity style={styles.card} onPress={onOpenThread} activeOpacity={0.7}>
      {/* Card content wrapper */}
      <View style={styles.cardContent}>
        {/* Header Row: LEFT = Identity, RIGHT = Type pill */}
        <View style={styles.cardHeader}>
          {/* LEFT: Owner Identity */}
          <View style={styles.ownerIdentity}>
            {!isAnon && prompt.ownerPhotoUrl ? (
              <Image source={{ uri: prompt.ownerPhotoUrl }} style={styles.ownerPhoto} />
            ) : (
              <View style={styles.ownerPhotoPlaceholder}>
                <Ionicons name={isAnon ? 'eye-off' : 'person'} size={12} color={C.textLight} />
              </View>
            )}
            <View style={styles.ownerInfo}>
              <Text style={styles.ownerName} numberOfLines={1}>
                {isAnon ? 'Anonymous' : (prompt.ownerName || 'User')}
                {prompt.ownerAge ? `, ${prompt.ownerAge}` : ''}
              </Text>
              {prompt.ownerGender && (
                <Ionicons name={getGenderIcon(prompt.ownerGender)} size={11} color={C.textLight} />
              )}
            </View>
          </View>

          {/* RIGHT: Type pill */}
          <View style={[styles.typePill, { backgroundColor: isTruth ? '#6C5CE7' : '#E17055' }]}>
            <Ionicons name={isTruth ? 'help-circle' : 'flash'} size={10} color="#FFF" />
            <Text style={styles.typePillText}>{isTruth ? 'Truth' : 'Dare'}</Text>
          </View>
        </View>

        {/* Prompt text */}
        <Text style={styles.promptText} numberOfLines={3}>{prompt.text}</Text>

        {/* Comment previews (up to 2) */}
        {previewCount > 0 && (
          <View style={styles.previewSection}>
            {prompt.top2Answers.map((answer) => (
              <CommentPreviewRow key={answer._id} answer={answer} />
            ))}
          </View>
        )}

        {/* Footer: +N more */}
        <View style={styles.cardFooter}>
          <Text style={styles.moreCountLabel}>+{answerCount} more</Text>
        </View>
      </View>

      {/* Big + button on right side */}
      <TouchableOpacity
        style={styles.addButton}
        onPress={(e) => { e.stopPropagation(); onAddComment(); }}
        activeOpacity={0.8}
      >
        <Ionicons name="add" size={22} color="#FFF" />
      </TouchableOpacity>
    </TouchableOpacity>
  );
}

/* ─── Main Screen ─── */
export default function TruthOrDareScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [refreshKey, setRefreshKey] = useState(0);

  const userId = useAuthStore((s) => s.userId);

  // Get trending prompts (1 Dare + 1 Truth)
  const trendingData = useQuery(api.truthDare.getTrendingTruthAndDare);

  // Get all prompts (sorted by engagement)
  const promptsData = useQuery(
    api.truthDare.listActivePromptsWithTop2Answers,
    { viewerUserId: userId ?? undefined }
  );

  const isLoading = promptsData === undefined || trendingData === undefined;
  const prompts = promptsData ?? [];

  // Get trending prompt IDs to exclude from normal list
  const trendingIds = useMemo(() => {
    const ids = new Set<string>();
    if (trendingData?.trendingDarePrompt) {
      ids.add(trendingData.trendingDarePrompt._id as unknown as string);
    }
    if (trendingData?.trendingTruthPrompt) {
      ids.add(trendingData.trendingTruthPrompt._id as unknown as string);
    }
    return ids;
  }, [trendingData]);

  // Filter out trending prompts from normal list
  const normalPrompts = useMemo(() => {
    return prompts.filter((p) => !trendingIds.has(p._id as unknown as string));
  }, [prompts, trendingIds]);

  const onRefresh = useCallback(() => {
    setRefreshKey((k: number) => k + 1);
  }, []);

  const openThread = useCallback((promptId: string) => {
    router.push({ pathname: '/(main)/prompt-thread' as any, params: { promptId } });
  }, [router]);

  const openCreateTod = useCallback(() => {
    router.push('/(main)/incognito-create-tod' as any);
  }, [router]);

  // Open thread for adding comment (same as opening thread, composer auto-shows)
  const openThreadForComment = useCallback((promptId: string) => {
    router.push({ pathname: '/(main)/prompt-thread' as any, params: { promptId, autoOpenComposer: 'true' } });
  }, [router]);

  type FeedItem =
    | { type: 'section'; label: string }
    | { type: 'trending'; prompt: TrendingPromptData }
    | { type: 'prompt'; prompt: typeof prompts[0] };

  const feedData: FeedItem[] = useMemo(() => {
    const items: FeedItem[] = [];

    // Trending section (Dare first, then Truth)
    const hasTrendingDare = !!trendingData?.trendingDarePrompt;
    const hasTrendingTruth = !!trendingData?.trendingTruthPrompt;

    if (hasTrendingDare || hasTrendingTruth) {
      items.push({ type: 'section', label: '🔥 Trending' });
      if (hasTrendingDare) {
        items.push({ type: 'trending', prompt: trendingData!.trendingDarePrompt! });
      }
      if (hasTrendingTruth) {
        items.push({ type: 'trending', prompt: trendingData!.trendingTruthPrompt! });
      }
    }

    // Normal prompts section
    if (normalPrompts.length > 0) {
      items.push({ type: 'section', label: 'More Truths & Dares' });
      normalPrompts.forEach((p) => items.push({ type: 'prompt', prompt: p }));
    }

    return items;
  }, [trendingData, normalPrompts]);

  const renderItem = ({ item }: { item: FeedItem }) => {
    if (item.type === 'section') {
      return <Text style={styles.sectionLabel}>{item.label}</Text>;
    }

    if (item.type === 'trending') {
      const promptId = item.prompt._id as unknown as string;
      return (
        <TrendingCard
          prompt={item.prompt}
          onOpenThread={() => openThread(promptId)}
          onAddComment={() => openThreadForComment(promptId)}
        />
      );
    }

    const promptId = item.prompt._id as unknown as string;
    return (
      <PromptCard
        prompt={item.prompt}
        onOpenThread={() => openThread(promptId)}
        onAddComment={() => openThreadForComment(promptId)}
      />
    );
  };

  const getKey = (item: FeedItem, idx: number) => {
    if (item.type === 'section') return `section_${idx}`;
    if (item.type === 'trending') return `trending_${item.prompt._id}`;
    return `prompt_${item.prompt._id}`;
  };

  if (isLoading) {
    return (
      <View style={[styles.container, styles.centered, { paddingTop: insets.top }]}>
        <ActivityIndicator size="large" color={C.primary} />
        <Text style={styles.loadingText}>Loading...</Text>
      </View>
    );
  }

  if (prompts.length === 0) {
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <View style={styles.header}>
          <Ionicons name="flame" size={16} color={C.primary} />
          <Text style={styles.headerTitle}>Truth or Dare</Text>
        </View>
        <View style={styles.emptyState}>
          <Ionicons name="help-circle-outline" size={48} color={C.textLight} />
          <Text style={styles.emptyTitle}>No active prompts</Text>
          <Text style={styles.emptySubtitle}>Be the first to create a Truth or Dare!</Text>
          <TouchableOpacity style={styles.createFirstBtn} onPress={openCreateTod}>
            <Ionicons name="add" size={18} color="#FFF" />
            <Text style={styles.createFirstBtnText}>Create Post</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Ionicons name="flame" size={16} color={C.primary} />
        <Text style={styles.headerTitle}>Truth or Dare</Text>
      </View>

      <FlatList
        data={feedData}
        keyExtractor={getKey}
        renderItem={renderItem}
        contentContainerStyle={styles.listContent}
        refreshControl={
          <RefreshControl
            refreshing={false}
            onRefresh={onRefresh}
            tintColor={C.primary}
          />
        }
      />

      <TouchableOpacity
        style={styles.fab}
        onPress={openCreateTod}
        activeOpacity={0.85}
      >
        <Ionicons name="add" size={24} color="#FFF" />
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.background },
  centered: { justifyContent: 'center', alignItems: 'center' },
  loadingText: { marginTop: 12, fontSize: 14, color: C.textLight },

  header: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 14, paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: C.surface,
  },
  headerTitle: { fontSize: 16, fontWeight: '700', color: C.text },

  sectionLabel: {
    fontSize: 11, fontWeight: '700', color: C.textLight,
    textTransform: 'uppercase', letterSpacing: 0.5,
    paddingHorizontal: 14, paddingTop: 12, paddingBottom: 4,
  },

  listContent: { paddingBottom: 96 },

  // Card - compact layout with + button on right
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 10, marginVertical: 4,
    backgroundColor: C.surface, borderRadius: 12,
    paddingLeft: 10, paddingRight: 6, paddingVertical: 10,
  },

  // Card content (left side, takes most space)
  cardContent: {
    flex: 1,
    paddingRight: 8,
  },

  // Header Row
  cardHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginBottom: 6,
  },

  // Owner Identity (LEFT side)
  ownerIdentity: {
    flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1,
  },
  ownerPhoto: {
    width: 26, height: 26, borderRadius: 13, backgroundColor: C.accent,
  },
  ownerPhotoPlaceholder: {
    width: 26, height: 26, borderRadius: 13, backgroundColor: C.accent,
    alignItems: 'center', justifyContent: 'center',
  },
  ownerInfo: {
    flexDirection: 'row', alignItems: 'center', gap: 4, flex: 1,
  },
  ownerName: {
    fontSize: 12, fontWeight: '600', color: C.text,
  },

  // Type pill (RIGHT side)
  typePill: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    paddingHorizontal: 7, paddingVertical: 3, borderRadius: 8,
  },
  typePillText: { fontSize: 9, fontWeight: '700', color: '#FFF' },

  // Prompt text
  promptText: {
    fontSize: 14, fontWeight: '500', color: C.text, lineHeight: 19,
    marginBottom: 6,
  },

  // Comment preview section
  previewSection: {
    gap: 3, marginBottom: 4,
  },
  commentRow: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
  },
  commentAvatar: {
    width: 16, height: 16, borderRadius: 8, backgroundColor: C.accent,
    alignItems: 'center', justifyContent: 'center',
  },
  commentText: {
    flex: 1, fontSize: 11, color: C.text, lineHeight: 14,
  },
  commentName: {
    fontWeight: '600', color: C.text,
  },
  commentSnippet: {
    color: C.textLight,
  },
  commentMedia: {
    color: C.primary, fontWeight: '500',
  },

  // Card footer (+N more)
  cardFooter: {
    flexDirection: 'row', alignItems: 'center',
    marginTop: 2,
  },
  moreCountLabel: {
    fontSize: 12, fontWeight: '700', color: C.primary,
  },

  // Big + button on right side of card
  addButton: {
    width: 38, height: 38, borderRadius: 19,
    backgroundColor: C.primary,
    alignItems: 'center', justifyContent: 'center',
    marginLeft: 4,
  },

  // Empty state
  emptyState: {
    flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 12,
  },
  emptyTitle: { fontSize: 18, fontWeight: '600', color: C.text },
  emptySubtitle: { fontSize: 14, color: C.textLight, textAlign: 'center' },
  createFirstBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: C.primary, paddingHorizontal: 16, paddingVertical: 10, borderRadius: 20,
    marginTop: 8,
  },
  createFirstBtnText: { fontSize: 14, fontWeight: '600', color: '#FFF' },

  // FAB
  fab: {
    position: 'absolute',
    right: 16,
    bottom: 24,
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: C.primary,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 6,
  },
});
