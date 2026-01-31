import React, { useState, useCallback, useEffect, useRef } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity, Alert,
  RefreshControl, Animated,
} from 'react-native';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { INCOGNITO_COLORS } from '@/lib/constants';
import {
  DEMO_TRENDING_PROMPTS, DEMO_TRENDING_ANSWERS,
  DEMO_OTHER_PROMPTS, DEMO_OTHER_ANSWERS,
} from '@/lib/demoData';
import { TextComposerModal } from '@/components/truthdare/TextComposerModal';
import { VoiceComposer } from '@/components/truthdare/VoiceComposer';
import { getTimeAgo } from '@/lib/utils';
import type { TodPrompt, TodAnswer, TodProfileVisibility } from '@/types';

const C = INCOGNITO_COLORS;
const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000;

/* ─── Inline "+" Menu (Text / Voice / Camera) ─── */
function InlinePlusMenu({
  hasAnswered,
  onSelectText,
  onSelectVoice,
  onSelectCamera,
}: {
  hasAnswered: boolean;
  onSelectText: () => void;
  onSelectVoice: () => void;
  onSelectCamera: () => void;
}) {
  const [open, setOpen] = useState(false);
  const anim = useRef(new Animated.Value(0)).current;

  const toggle = () => {
    if (hasAnswered) {
      Alert.alert('Already posted', 'You already posted for this prompt.');
      return;
    }
    const toOpen = !open;
    setOpen(toOpen);
    Animated.spring(anim, {
      toValue: toOpen ? 1 : 0,
      useNativeDriver: true,
      friction: 8,
      tension: 100,
    }).start();
  };

  const close = () => {
    setOpen(false);
    Animated.spring(anim, {
      toValue: 0,
      useNativeDriver: true,
      friction: 8,
      tension: 100,
    }).start();
  };

  const select = (handler: () => void) => {
    close();
    handler();
  };

  const optionsOpacity = anim.interpolate({
    inputRange: [0, 0.5, 1],
    outputRange: [0, 0, 1],
  });
  const optionsScale = anim.interpolate({
    inputRange: [0, 1],
    outputRange: [0.85, 1],
  });
  const optionsTranslateX = anim.interpolate({
    inputRange: [0, 1],
    outputRange: [20, 0],
  });

  return (
    <View style={styles.inlineMenuWrap}>
      {/* Always mounted, absolute overlay — no layout reflow */}
      <Animated.View
        style={[
          styles.inlineOptions,
          {
            opacity: optionsOpacity,
            transform: [{ scale: optionsScale }, { translateX: optionsTranslateX }],
          },
        ]}
        pointerEvents={open ? 'auto' : 'none'}
      >
        <TouchableOpacity style={styles.inlineIcon} onPress={() => select(onSelectText)} hitSlop={6}>
          <Ionicons name="create-outline" size={18} color="#6C5CE7" />
        </TouchableOpacity>
        <TouchableOpacity style={styles.inlineIcon} onPress={() => select(onSelectVoice)} hitSlop={6}>
          <Ionicons name="mic-outline" size={18} color="#FF9800" />
        </TouchableOpacity>
        <TouchableOpacity style={styles.inlineIcon} onPress={() => select(onSelectCamera)} hitSlop={6}>
          <Ionicons name="camera-outline" size={18} color="#E94560" />
        </TouchableOpacity>
      </Animated.View>

      <TouchableOpacity
        style={[styles.plusBtn, hasAnswered && styles.plusBtnDisabled, open && styles.plusBtnOpen]}
        onPress={toggle}
        activeOpacity={0.7}
      >
        <Ionicons
          name={hasAnswered ? 'checkmark' : open ? 'close' : 'add'}
          size={20}
          color={hasAnswered ? C.textLight : '#FFF'}
        />
      </TouchableOpacity>
    </View>
  );
}

/* ─── Poster Profile Row ─── */
function PosterProfile({ prompt, onPress }: { prompt: TodPrompt; onPress: () => void }) {
  const genderIcon = prompt.ownerGender === 'male' ? 'male' : prompt.ownerGender === 'female' ? 'female' : 'male-female';

  return (
    <TouchableOpacity style={styles.posterRow} onPress={onPress} activeOpacity={0.7}>
      {prompt.ownerPhotoUrl ? (
        <Image source={{ uri: prompt.ownerPhotoUrl }} style={styles.posterAvatar} />
      ) : (
        <View style={styles.posterAvatarPlaceholder}>
          <Ionicons name="person" size={12} color={C.textLight} />
        </View>
      )}
      <Text style={styles.posterName} numberOfLines={1}>{prompt.ownerName || 'Anonymous'}</Text>
      {prompt.ownerAge ? <Text style={styles.posterAge}>{prompt.ownerAge}</Text> : null}
      <Ionicons name={genderIcon} size={11} color={C.textLight} />
    </TouchableOpacity>
  );
}

/* ─── Trending Card (question only — NO answers/previews) ─── */
function TrendingCard({
  prompt,
  hasAnswered,
  onSelectText,
  onSelectVoice,
  onSelectCamera,
  onPressMore,
  onPressProfile,
}: {
  prompt: TodPrompt;
  hasAnswered: boolean;
  onSelectText: () => void;
  onSelectVoice: () => void;
  onSelectCamera: () => void;
  onPressMore: () => void;
  onPressProfile: () => void;
}) {
  const isTruth = prompt.type === 'truth';

  return (
    <TouchableOpacity style={styles.card} activeOpacity={0.8} onPress={onPressMore}>
      {/* Top-right type badge overlay */}
      <View style={[styles.typeBadgeOverlay, { backgroundColor: isTruth ? 'rgba(108,92,231,0.85)' : 'rgba(225,112,85,0.85)' }]}>
        <Text style={styles.typeBadgeText}>{isTruth ? 'Truth' : 'Dare'}</Text>
      </View>
      <PosterProfile prompt={prompt} onPress={onPressProfile} />
      <View style={styles.cardBody}>
        <Text style={styles.cardPromptFull}>{prompt.text}</Text>
        <InlinePlusMenu
          hasAnswered={hasAnswered}
          onSelectText={onSelectText}
          onSelectVoice={onSelectVoice}
          onSelectCamera={onSelectCamera}
        />
      </View>
      <View style={styles.trendingFooter}>
        <Text style={styles.trendingFooterText}>{prompt.answerCount} answers</Text>
        <Ionicons name="chevron-forward" size={12} color={C.textLight} />
      </View>
    </TouchableOpacity>
  );
}

/* ─── Non-Trending Prompt Card (2 previews + "More") ─── */
function PromptCard({
  prompt,
  previews,
  totalAnswers,
  hasAnswered,
  onSelectText,
  onSelectVoice,
  onSelectCamera,
  onPressMore,
  onPressProfile,
}: {
  prompt: TodPrompt;
  previews: TodAnswer[];
  totalAnswers: number;
  hasAnswered: boolean;
  onSelectText: () => void;
  onSelectVoice: () => void;
  onSelectCamera: () => void;
  onPressMore: () => void;
  onPressProfile: () => void;
}) {
  const isTruth = prompt.type === 'truth';
  const hiddenCount = totalAnswers - previews.length;

  return (
    <TouchableOpacity style={styles.card} activeOpacity={0.8} onPress={onPressMore}>
      {/* Top-right type badge overlay */}
      <View style={[styles.typeBadgeOverlay, { backgroundColor: isTruth ? 'rgba(108,92,231,0.85)' : 'rgba(225,112,85,0.85)' }]}>
        <Text style={styles.typeBadgeText}>{isTruth ? 'Truth' : 'Dare'}</Text>
      </View>
      <PosterProfile prompt={prompt} onPress={onPressProfile} />
      <View style={styles.cardBody}>
        <Text style={styles.cardPrompt} numberOfLines={2}>{prompt.text}</Text>
        <InlinePlusMenu
          hasAnswered={hasAnswered}
          onSelectText={onSelectText}
          onSelectVoice={onSelectVoice}
          onSelectCamera={onSelectCamera}
        />
      </View>

      {/* Up to 2 response previews */}
      {previews.length > 0 && (
        <View style={styles.previewsArea}>
          {previews.map((answer) => {
            const previewBlurred = answer.isAnonymous && answer.profileVisibility !== 'clear';
            return (
            <View key={answer.id} style={styles.previewRow}>
              {answer.userPhotoUrl ? (
                <Image
                  source={{ uri: answer.userPhotoUrl }}
                  style={styles.previewAvatar}
                  blurRadius={previewBlurred ? 8 : 0}
                />
              ) : (
                <View style={styles.previewAvatarPlaceholder}>
                  <Ionicons name="person" size={9} color={C.textLight} />
                </View>
              )}
              <Text style={styles.previewName}>{answer.userName}</Text>
              {answer.type === 'text' ? (
                <Text style={styles.previewText} numberOfLines={1}>{answer.text}</Text>
              ) : answer.type === 'voice' ? (
                <View style={styles.previewMediaTag}>
                  <Ionicons name="mic" size={10} color="#FF9800" />
                  <Text style={styles.previewMediaText}>{answer.durationSec}s</Text>
                </View>
              ) : (
                <View style={styles.previewMediaTag}>
                  <Ionicons name="lock-closed" size={10} color={C.textLight} />
                  <Text style={styles.previewMediaText}>Media</Text>
                </View>
              )}
            </View>
            );
          })}
        </View>
      )}

      {/* "More" */}
      {hiddenCount > 0 && (
        <View style={styles.moreRow}>
          <Text style={styles.moreText}>+{hiddenCount} more</Text>
        </View>
      )}
    </TouchableOpacity>
  );
}

/* ─── Main Screen ─── */
export default function TruthOrDareScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [refreshing, setRefreshing] = useState(false);

  // Composer state
  const [composerPrompt, setComposerPrompt] = useState<TodPrompt | null>(null);
  const [showTextComposer, setShowTextComposer] = useState(false);
  const [showVoiceComposer, setShowVoiceComposer] = useState(false);

  // Track answered prompts (demo: local)
  const [answeredPromptIds, setAnsweredPromptIds] = useState<Set<string>>(new Set());

  // Demo data — filter out expired (> 7 days)
  const now = Date.now();

  const allAnswers = [...DEMO_TRENDING_ANSWERS, ...DEMO_OTHER_ANSWERS];

  const isNotExpired = (p: TodPrompt) => {
    const expires = p.expiresAt ?? p.createdAt + SEVEN_DAYS;
    return expires > now;
  };

  // Trending: exactly 1 Truth + 1 Dare using isTrending flag
  const allPrompts = [...DEMO_TRENDING_PROMPTS, ...DEMO_OTHER_PROMPTS].filter(isNotExpired);
  const trendingTruth = allPrompts.find((p) => p.isTrending && p.type === 'truth');
  const trendingDare = allPrompts.find((p) => p.isTrending && p.type === 'dare');
  const trendingPrompts = [trendingTruth, trendingDare].filter(Boolean) as TodPrompt[];
  const trendingIds = new Set(trendingPrompts.map((p) => p.id));
  const otherPrompts = allPrompts
    .filter((p) => !trendingIds.has(p.id))
    .sort((a, b) => b.createdAt - a.createdAt);

  // Mark prompt as answered when returning from camera-composer
  // (camera-composer saves media to AsyncStorage, prompt-thread picks it up via its own poll)
  useEffect(() => {
    const check = async () => {
      try {
        const raw = await AsyncStorage.getItem('tod_answered_prompts');
        if (raw) {
          const ids: string[] = JSON.parse(raw);
          if (ids.length > 0) {
            setAnsweredPromptIds((prev) => {
              const next = new Set(prev);
              ids.forEach((id) => next.add(id));
              return next;
            });
          }
        }
      } catch { /* silent */ }
    };
    check();
    const interval = setInterval(check, 2000);
    return () => clearInterval(interval);
  }, []);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    setTimeout(() => setRefreshing(false), 800);
  }, []);

  // Previews: up to N, prioritize text/voice (visible to all)
  const getPreviews = (promptId: string, max: number): TodAnswer[] => {
    const answers = allAnswers
      .filter((a) => a.promptId === promptId)
      .sort((a, b) => a.createdAt - b.createdAt);
    const tv = answers.filter((a) => a.type === 'text' || a.type === 'voice');
    const media = answers.filter((a) => a.type === 'photo' || a.type === 'video');
    return [...tv, ...media].slice(0, max);
  };

  const getTotalAnswers = (promptId: string): number =>
    allAnswers.filter((a) => a.promptId === promptId).length;

  // Composer helpers
  const selectText = (prompt: TodPrompt) => {
    setComposerPrompt(prompt);
    setShowTextComposer(true);
  };

  const selectVoice = (prompt: TodPrompt) => {
    setComposerPrompt(prompt);
    setShowVoiceComposer(true);
  };

  // Camera handles both photo and video (Telegram-style)
  const selectCamera = (prompt: TodPrompt) => {
    router.push({
      pathname: '/(main)/camera-composer' as any,
      params: { promptId: prompt.id, promptType: prompt.type },
    });
  };

  const handleTextSubmit = (text: string, _isAnonymous?: boolean, _profileVisibility?: TodProfileVisibility) => {
    setShowTextComposer(false);
    if (composerPrompt) {
      const pid = composerPrompt.id;
      setAnsweredPromptIds((prev) => new Set([...prev, pid]));
      openThread(pid);
    }
  };

  const handleVoiceSubmit = (durationSec: number, _isAnonymous?: boolean, _profileVisibility?: TodProfileVisibility) => {
    setShowVoiceComposer(false);
    if (composerPrompt) {
      const pid = composerPrompt.id;
      setAnsweredPromptIds((prev) => new Set([...prev, pid]));
      openThread(pid);
    }
  };

  const openThread = (promptId: string) => {
    router.push({ pathname: '/(main)/prompt-thread' as any, params: { promptId } });
  };

  const openProfile = (userId: string) => {
    router.push({ pathname: '/(main)/private-profile/[userId]' as any, params: { userId } });
  };

  // Build feed
  type FeedItem =
    | { type: 'trending'; prompt: TodPrompt }
    | { type: 'section'; label: string }
    | { type: 'other'; prompt: TodPrompt };

  const feedData: FeedItem[] = [];
  trendingPrompts.forEach((p) => feedData.push({ type: 'trending', prompt: p }));
  if (otherPrompts.length > 0) {
    feedData.push({ type: 'section', label: 'More Truths & Dares' });
    otherPrompts.forEach((p) => feedData.push({ type: 'other', prompt: p }));
  }

  const renderItem = ({ item }: { item: FeedItem }) => {
    if (item.type === 'section') {
      return <Text style={styles.sectionLabel}>{item.label}</Text>;
    }

    if (item.type === 'trending') {
      return (
        <TrendingCard
          prompt={item.prompt}
          hasAnswered={answeredPromptIds.has(item.prompt.id)}
          onSelectText={() => selectText(item.prompt)}
          onSelectVoice={() => selectVoice(item.prompt)}
          onSelectCamera={() => selectCamera(item.prompt)}
          onPressMore={() => openThread(item.prompt.id)}
          onPressProfile={() => openProfile(item.prompt.ownerUserId)}
        />
      );
    }

    // Non-trending: show 2 previews + More
    return (
      <PromptCard
        prompt={item.prompt}
        previews={getPreviews(item.prompt.id, 2)}
        totalAnswers={getTotalAnswers(item.prompt.id)}
        hasAnswered={answeredPromptIds.has(item.prompt.id)}
        onSelectText={() => selectText(item.prompt)}
        onSelectVoice={() => selectVoice(item.prompt)}
        onSelectCamera={() => selectCamera(item.prompt)}
        onPressMore={() => openThread(item.prompt.id)}
        onPressProfile={() => openProfile(item.prompt.ownerUserId)}
      />
    );
  };

  const getKey = (item: FeedItem, idx: number) => {
    if (item.type === 'section') return `sh_${idx}`;
    return `p_${item.prompt.id}`;
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* Compact header — "Trending" only */}
      <View style={styles.header}>
        <Ionicons name="flame" size={16} color={C.primary} />
        <Text style={styles.headerTitle}>Trending</Text>
      </View>

      <FlatList
        data={feedData}
        keyExtractor={getKey}
        renderItem={renderItem}
        contentContainerStyle={styles.listContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.primary} />}
      />

      <TextComposerModal
        visible={showTextComposer}
        prompt={composerPrompt}
        onClose={() => setShowTextComposer(false)}
        onSubmit={handleTextSubmit}
      />

      <VoiceComposer
        visible={showVoiceComposer}
        prompt={composerPrompt}
        onClose={() => setShowVoiceComposer(false)}
        onSubmit={handleVoiceSubmit}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.background },

  header: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 14, paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: C.surface,
  },
  headerTitle: { fontSize: 15, fontWeight: '700', color: C.text },

  sectionLabel: {
    fontSize: 11, fontWeight: '700', color: C.textLight, textTransform: 'uppercase',
    letterSpacing: 1, paddingHorizontal: 14, paddingTop: 10, paddingBottom: 4,
  },

  listContent: { paddingBottom: 32 },

  // ─── Poster Profile ───
  posterRow: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 10, paddingTop: 10, paddingBottom: 2,
  },
  posterAvatar: { width: 22, height: 22, borderRadius: 11, backgroundColor: C.accent },
  posterAvatarPlaceholder: {
    width: 22, height: 22, borderRadius: 11, backgroundColor: C.accent,
    alignItems: 'center', justifyContent: 'center',
  },
  posterName: { fontSize: 12, fontWeight: '600', color: C.text, maxWidth: 120 },
  posterAge: { fontSize: 11, color: C.textLight },

  // ─── Card (shared base) ───
  card: {
    marginHorizontal: 10, marginVertical: 4,
    backgroundColor: C.surface, borderRadius: 12,
    overflow: 'hidden',
    position: 'relative',
  },
  // Top-right overlay badge
  typeBadgeOverlay: {
    position: 'absolute', top: 8, right: 8, zIndex: 2,
    paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12,
  },
  typeBadgeText: { fontSize: 10, fontWeight: '700', color: '#FFF' },
  // Card body (question + plus menu)
  cardBody: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 10, paddingBottom: 8, gap: 8,
  },
  // Non-trending: 2 lines max
  cardPrompt: { flex: 1, fontSize: 13, fontWeight: '600', color: C.text, lineHeight: 18 },
  // Trending: full text, no truncation
  cardPromptFull: { flex: 1, fontSize: 13, fontWeight: '600', color: C.text, lineHeight: 18 },

  // ─── Trending footer ───
  trendingFooter: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 10, paddingBottom: 8,
  },
  trendingFooterText: { fontSize: 11, color: C.textLight },

  // ─── Inline Plus Menu ───
  inlineMenuWrap: { flexDirection: 'row', alignItems: 'center', position: 'relative' },
  inlineOptions: {
    position: 'absolute', right: 42, top: -4,
    flexDirection: 'row', alignItems: 'center', gap: 4,
  },
  inlineIcon: {
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: C.accent, alignItems: 'center', justifyContent: 'center',
  },
  plusBtn: {
    width: 34, height: 34, borderRadius: 17,
    backgroundColor: C.primary, alignItems: 'center', justifyContent: 'center',
  },
  plusBtnDisabled: { backgroundColor: C.accent },
  plusBtnOpen: { backgroundColor: C.textLight },

  // ─── Previews (non-trending only) ───
  previewsArea: { paddingHorizontal: 10, paddingBottom: 6, gap: 4 },
  previewRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  previewAvatar: { width: 18, height: 18, borderRadius: 9, backgroundColor: C.accent },
  previewAvatarPlaceholder: {
    width: 18, height: 18, borderRadius: 9, backgroundColor: C.accent,
    alignItems: 'center', justifyContent: 'center',
  },
  previewName: { fontSize: 11, fontWeight: '600', color: C.text },
  previewText: { flex: 1, fontSize: 11, color: C.textLight, lineHeight: 15 },
  previewMediaTag: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  previewMediaText: { fontSize: 10, color: C.textLight },

  // ─── More ───
  moreRow: { paddingVertical: 6, paddingHorizontal: 10 },
  moreText: { fontSize: 11, fontWeight: '600', color: C.primary },

});
