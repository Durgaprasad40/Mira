import React, { useState, useCallback, useEffect, useRef } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity, Alert, Animated,
} from 'react-native';
import { Image } from 'expo-image';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { INCOGNITO_COLORS } from '@/lib/constants';
import {
  DEMO_TRENDING_PROMPTS, DEMO_TRENDING_ANSWERS,
  DEMO_OTHER_PROMPTS, DEMO_OTHER_ANSWERS,
} from '@/lib/demoData';
import { ConnectPopup } from '@/components/truthdare/ConnectPopup';
import { TextComposerModal } from '@/components/truthdare/TextComposerModal';
import { VoiceComposer } from '@/components/truthdare/VoiceComposer';
import { getTimeAgo } from '@/lib/utils';
import { useAuthStore } from '@/stores/authStore';
import type { TodAnswer, TodAnswerType, TodProfileVisibility } from '@/types';

const C = INCOGNITO_COLORS;
const ALL_PROMPTS = [...DEMO_TRENDING_PROMPTS, ...DEMO_OTHER_PROMPTS];
const ALL_ANSWERS = [...DEMO_TRENDING_ANSWERS, ...DEMO_OTHER_ANSWERS];

export default function PromptThreadScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { promptId } = useLocalSearchParams<{ promptId: string }>();
  const { userId } = useAuthStore();

  const prompt = ALL_PROMPTS.find((p) => p.id === promptId);
  const demoAnswers = ALL_ANSWERS.filter((a) => a.promptId === promptId);

  // User answers persisted in AsyncStorage (survive navigation)
  const [userAnswers, setUserAnswers] = useState<TodAnswer[]>([]);
  // Deleted answer IDs
  const [deletedIds, setDeletedIds] = useState<Set<string>>(new Set());

  // Storage keys
  const answersKey = `tod_user_answers_${promptId}`;
  const deletedKey = `tod_deleted_ids_${promptId}`;

  // Load persisted answers on mount
  useEffect(() => {
    const load = async () => {
      try {
        const [savedAnswers, savedDeleted] = await Promise.all([
          AsyncStorage.getItem(answersKey),
          AsyncStorage.getItem(deletedKey),
        ]);
        if (savedAnswers) setUserAnswers(JSON.parse(savedAnswers));
        if (savedDeleted) setDeletedIds(new Set(JSON.parse(savedDeleted)));
      } catch { /* silent */ }
    };
    load();
  }, [promptId]);

  // Persist answers whenever they change
  const persistAnswers = async (answers: TodAnswer[]) => {
    try {
      await AsyncStorage.setItem(answersKey, JSON.stringify(answers));
      // Also track which prompts the user answered (for truth-or-dare feed checkmarks)
      const raw = await AsyncStorage.getItem('tod_answered_prompts');
      const ids: string[] = raw ? JSON.parse(raw) : [];
      if (!ids.includes(promptId!)) {
        ids.push(promptId!);
        await AsyncStorage.setItem('tod_answered_prompts', JSON.stringify(ids));
      }
    } catch { /* silent */ }
  };

  const persistDeleted = async (ids: Set<string>) => {
    try {
      await AsyncStorage.setItem(deletedKey, JSON.stringify([...ids]));
    } catch { /* silent */ }
  };

  // Merge demo + user answers, filter deleted
  const answers = [...demoAnswers, ...userAnswers]
    .filter((a) => !deletedIds.has(a.id))
    .sort((a, b) => a.createdAt - b.createdAt);

  const hasAnswered = userAnswers.length > 0;
  const listRef = useRef<FlatList<TodAnswer>>(null);

  const scrollToEnd = () => {
    setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 200);
  };

  const [likedAnswerIds, setLikedAnswerIds] = useState<Set<string>>(new Set());
  const [connectPopup, setConnectPopup] = useState<{ visible: boolean; userName: string; userPhotoUrl?: string; answerId: string }>({
    visible: false, userName: '', answerId: '',
  });

  // Composer state
  const [showTextComposer, setShowTextComposer] = useState(false);
  const [showVoiceComposer, setShowVoiceComposer] = useState(false);
  const [showAnswerMenu, setShowAnswerMenu] = useState(false);

  const isPromptOwner = prompt?.ownerUserId === userId || prompt?.ownerUserId === 'system';
  const currentUserId = userId || 'demo_user_1';

  // Poll for camera media — stays on this page, just adds the answer
  useEffect(() => {
    const check = async () => {
      try {
        const data = await AsyncStorage.getItem('tod_captured_media');
        if (data) {
          await AsyncStorage.removeItem('tod_captured_media');
          const parsed = JSON.parse(data);
          if (parsed.promptId === promptId) {
            const newAnswer: TodAnswer = {
              id: `my_${Date.now()}`,
              promptId: promptId!,
              userId: currentUserId,
              userName: 'You',
              type: parsed.type as TodAnswerType,
              text: parsed.type === 'photo' ? 'My photo answer' : parsed.type === 'video' ? 'My video answer' : '',
              mediaUrl: parsed.uri,
              durationSec: parsed.durationSec,
              likeCount: 0,
              createdAt: Date.now(),
              visibility: parsed.visibility || 'owner_only',
            };
            setUserAnswers((prev) => {
              const updated = [...prev, newAnswer];
              persistAnswers(updated);
              return updated;
            });
            scrollToEnd();
          }
        }
      } catch { /* silent */ }
    };
    const interval = setInterval(check, 1000);
    return () => clearInterval(interval);
  }, [promptId, currentUserId]);

  const handleLike = useCallback((answer: TodAnswer) => {
    setLikedAnswerIds((prev) => {
      const next = new Set(prev);
      if (next.has(answer.id)) {
        next.delete(answer.id);
      } else {
        next.add(answer.id);
        // Connect popup: question owner likes any answer
        if (isPromptOwner && answer.userId !== currentUserId) {
          setConnectPopup({
            visible: true,
            userName: answer.userName || 'User',
            userPhotoUrl: answer.userPhotoUrl,
            answerId: answer.id,
          });
        }
      }
      return next;
    });
  }, [isPromptOwner, currentUserId]);

  const handleConnect = () => {
    setConnectPopup((p) => ({ ...p, visible: false }));
    Alert.alert('Connected!', 'You connected via Truth & Dare. Check your Messages tab.');
  };

  const handleRemove = () => {
    setConnectPopup((p) => ({ ...p, visible: false }));
  };

  const canViewMedia = (answer: TodAnswer) => {
    if (answer.type === 'text' || answer.type === 'voice') return true;
    if (answer.visibility === 'public') return true;
    return isPromptOwner || answer.userId === currentUserId;
  };

  // Delete own answer
  const handleDeleteAnswer = (answer: TodAnswer) => {
    Alert.alert(
      'Delete Answer',
      'Are you sure you want to delete your answer?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            setDeletedIds((prev) => {
              const next = new Set([...prev, answer.id]);
              persistDeleted(next);
              return next;
            });
            setUserAnswers((prev) => {
              const updated = prev.filter((a) => a.id !== answer.id);
              persistAnswers(updated);
              return updated;
            });
          },
        },
      ],
    );
  };

  // Answer composers — stay on this page, persist answer
  const handleTextSubmit = (text: string, isAnonymous?: boolean, profileVisibility?: TodProfileVisibility) => {
    setShowTextComposer(false);
    const newAnswer: TodAnswer = {
      id: `my_${Date.now()}`,
      promptId: promptId!,
      userId: currentUserId,
      userName: 'You',
      type: 'text',
      text,
      likeCount: 0,
      createdAt: Date.now(),
      isAnonymous: isAnonymous || false,
      profileVisibility: isAnonymous ? (profileVisibility || 'blurred') : 'clear',
    };
    setUserAnswers((prev) => {
      const updated = [...prev, newAnswer];
      persistAnswers(updated);
      return updated;
    });
    scrollToEnd();
  };

  const handleVoiceSubmit = (durationSec: number, isAnonymous?: boolean, profileVisibility?: TodProfileVisibility) => {
    setShowVoiceComposer(false);
    const newAnswer: TodAnswer = {
      id: `my_${Date.now()}`,
      promptId: promptId!,
      userId: currentUserId,
      userName: 'You',
      type: 'voice',
      text: 'Voice answer',
      durationSec,
      likeCount: 0,
      createdAt: Date.now(),
      isAnonymous: isAnonymous || false,
      profileVisibility: isAnonymous ? (profileVisibility || 'blurred') : 'clear',
    };
    setUserAnswers((prev) => {
      const updated = [...prev, newAnswer];
      persistAnswers(updated);
      return updated;
    });
    scrollToEnd();
  };

  const openCamera = () => {
    setShowAnswerMenu(false);
    router.push({
      pathname: '/(main)/camera-composer' as any,
      params: { promptId: promptId!, promptType: prompt?.type },
    });
  };

  const renderAnswer = ({ item, index }: { item: TodAnswer; index: number }) => {
    const isLiked = likedAnswerIds.has(item.id);
    const visible = canViewMedia(item);
    const isOwnAnswer = item.userId === currentUserId;
    const isAnon = item.isAnonymous && !isOwnAnswer;
    const isFirstAnswer = index === 0;
    const displayName = item.userName || 'Anonymous';
    const isBlurred = isAnon && item.profileVisibility !== 'clear';

    const handleProfileTap = () => {
      if (item.userId && !isOwnAnswer) {
        router.push({ pathname: '/(main)/private-profile/[userId]' as any, params: { userId: item.userId } });
      }
    };

    const handleMessageTap = () => {
      Alert.alert(
        'Upgrade to Message',
        'Messaging is available for premium subscribers. Upgrade to send direct messages.',
        [
          { text: 'Not now', style: 'cancel' },
          { text: 'Upgrade', onPress: () => {} },
        ],
      );
    };

    return (
      <TouchableOpacity
        style={styles.answerCard}
        activeOpacity={isOwnAnswer ? 0.6 : 1}
        onLongPress={isOwnAnswer ? () => handleDeleteAnswer(item) : undefined}
        delayLongPress={500}
      >
        <View style={styles.answerHeader}>
          <TouchableOpacity onPress={handleProfileTap} activeOpacity={0.7}>
            {item.userPhotoUrl ? (
              <Image
                source={{ uri: item.userPhotoUrl }}
                style={styles.answerAvatar}
                blurRadius={isBlurred ? 12 : 0}
              />
            ) : (
              <View style={styles.answerAvatarPlaceholder}>
                <Ionicons name="person" size={16} color={C.textLight} />
              </View>
            )}
            {isAnon && (
              <View style={styles.anonBadgeOverlay}>
                <Ionicons name="eye-off" size={8} color="#FFF" />
              </View>
            )}
          </TouchableOpacity>
          <View style={styles.answerInfo}>
            <View style={styles.answerNameRow}>
              <Text style={styles.answerName}>{displayName}</Text>
              {isAnon && item.userGender && (
                <View style={styles.genderBadge}>
                  <Ionicons
                    name={item.userGender === 'male' ? 'male' : item.userGender === 'female' ? 'female' : 'male-female'}
                    size={10}
                    color={C.textLight}
                  />
                </View>
              )}
              {isOwnAnswer && (
                <View style={styles.youBadge}>
                  <Text style={styles.youBadgeText}>You</Text>
                </View>
              )}
              {isFirstAnswer && (
                <View style={styles.firstBadge}>
                  <Text style={styles.firstBadgeText}>First</Text>
                </View>
              )}
            </View>
            <Text style={styles.answerTime}>{getTimeAgo(item.createdAt)}</Text>
          </View>
          {/* Message button for other users' answers (subscription-locked) */}
          {!isOwnAnswer && (
            <TouchableOpacity style={styles.msgLockBtn} onPress={handleMessageTap} activeOpacity={0.7}>
              <Ionicons name="chatbubble-outline" size={13} color={C.textLight} />
              <Ionicons name="lock-closed" size={8} color={C.textLight} style={{ marginLeft: 2 }} />
            </TouchableOpacity>
          )}
          <View style={[styles.typeBadge, {
            backgroundColor: item.type === 'text' ? '#6C5CE720' : item.type === 'voice' ? '#FF980020' : item.type === 'photo' ? '#E9456020' : '#00B89420',
          }]}>
            <Ionicons
              name={item.type === 'text' ? 'create-outline' : item.type === 'voice' ? 'mic-outline' : item.type === 'photo' ? 'camera-outline' : 'videocam-outline'}
              size={12}
              color={item.type === 'text' ? '#6C5CE7' : item.type === 'voice' ? '#FF9800' : item.type === 'photo' ? '#E94560' : '#00B894'}
            />
            <Text style={[styles.typeBadgeText, {
              color: item.type === 'text' ? '#6C5CE7' : item.type === 'voice' ? '#FF9800' : item.type === 'photo' ? '#E94560' : '#00B894',
            }]}>{item.type}</Text>
          </View>
        </View>

        {/* Content */}
        {item.type === 'text' && (
          <Text style={styles.answerText}>{item.text}</Text>
        )}

        {item.type === 'voice' && (
          <TouchableOpacity style={styles.voiceRow} activeOpacity={0.7}>
            <Ionicons name="play-circle" size={32} color={C.primary} />
            <View style={styles.voiceWaveform}>
              {Array.from({ length: 16 }).map((_, i) => (
                <View key={i} style={[styles.voiceBar, { height: 4 + (i % 4) * 6 }]} />
              ))}
            </View>
            <Text style={styles.voiceDuration}>{item.durationSec}s</Text>
          </TouchableOpacity>
        )}

        {item.type === 'photo' && (
          visible ? (
            <View style={styles.mediaContainer}>
              <Image source={{ uri: item.mediaUrl }} style={styles.mediaImage} contentFit="cover" />
            </View>
          ) : (
            <View style={styles.hiddenMedia}>
              <Ionicons name="eye-off" size={20} color={C.textLight} />
              <Text style={styles.hiddenText}>Media hidden by user</Text>
            </View>
          )
        )}

        {item.type === 'video' && (
          visible ? (
            <View style={styles.mediaContainer}>
              <View style={styles.videoPlaceholder}>
                <Ionicons name="play-circle" size={40} color="#FFF" />
                <Text style={styles.videoLabel}>{item.durationSec}s video</Text>
              </View>
            </View>
          ) : (
            <View style={styles.hiddenMedia}>
              <Ionicons name="eye-off" size={20} color={C.textLight} />
              <Text style={styles.hiddenText}>Media hidden by user</Text>
            </View>
          )
        )}

        {/* Like row */}
        <View style={styles.answerActions}>
          <TouchableOpacity style={styles.likeBtn} onPress={() => handleLike(item)}>
            <Ionicons name={isLiked ? 'heart' : 'heart-outline'} size={18} color={isLiked ? C.primary : C.textLight} />
            <Text style={[styles.likeCount, isLiked && { color: C.primary }]}>
              {item.likeCount + (isLiked ? 1 : 0)}
            </Text>
          </TouchableOpacity>
          {isOwnAnswer && (
            <TouchableOpacity style={styles.deleteBtn} onPress={() => handleDeleteAnswer(item)}>
              <Ionicons name="trash-outline" size={15} color={C.textLight} />
            </TouchableOpacity>
          )}
        </View>
      </TouchableOpacity>
    );
  };

  if (!prompt) {
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <Text style={styles.errorText}>Prompt not found</Text>
      </View>
    );
  }

  const isTruth = prompt.type === 'truth';

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={24} color={C.text} />
        </TouchableOpacity>
        <View style={[styles.headerBadge, { backgroundColor: isTruth ? '#6C5CE7' : '#E17055' }]}>
          <Text style={styles.headerBadgeText}>{isTruth ? 'TRUTH' : 'DARE'}</Text>
        </View>
        <Text style={styles.headerTitle}>Thread</Text>
        <View style={{ flex: 1 }} />
        <Text style={styles.headerCount}>{answers.length} answers</Text>
      </View>

      {/* Poster profile + Prompt text */}
      <View style={styles.promptBox}>
        <TouchableOpacity
          style={styles.posterRow}
          activeOpacity={0.7}
          onPress={() => router.push({ pathname: '/(main)/private-profile/[userId]' as any, params: { userId: prompt.ownerUserId } })}
        >
          {prompt.ownerPhotoUrl ? (
            <Image source={{ uri: prompt.ownerPhotoUrl }} style={styles.posterAvatar} />
          ) : (
            <View style={styles.posterAvatarPlaceholder}>
              <Ionicons name="person" size={14} color={C.textLight} />
            </View>
          )}
          <Text style={styles.posterName}>{prompt.ownerName || 'Anonymous'}</Text>
          {prompt.ownerAge ? <Text style={styles.posterAge}>{prompt.ownerAge}</Text> : null}
          <Ionicons
            name={prompt.ownerGender === 'male' ? 'male' : prompt.ownerGender === 'female' ? 'female' : 'male-female'}
            size={12}
            color={C.textLight}
          />
        </TouchableOpacity>
        <Text style={styles.promptText}>{prompt.text}</Text>
        <View style={styles.promptStats}>
          <Text style={styles.promptStatText}>{prompt.answerCount} answers</Text>
          <Text style={styles.promptStatDot}>{'\u00B7'}</Text>
          <Text style={styles.promptStatText}>{prompt.activeCount} active</Text>
        </View>
      </View>

      {/* Answers list */}
      <FlatList
        ref={listRef}
        data={answers}
        keyExtractor={(item) => item.id}
        renderItem={renderAnswer}
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={
          <View style={styles.emptyBox}>
            <Text style={styles.emptyText}>No answers yet. Be the first!</Text>
          </View>
        }
      />

      {/* Fixed bottom-right + button with overlay options — no layout reflow */}
      {!hasAnswered && (
        <View style={[styles.answerFab, { bottom: Math.max(insets.bottom, 12) + 8 }]}>
          {/* Options overlay — always mounted, animated opacity/scale only */}
          <Animated.View
            style={[
              styles.fabOptions,
              {
                opacity: showAnswerMenu ? 1 : 0,
                transform: [{ scale: showAnswerMenu ? 1 : 0.85 }],
              },
            ]}
            pointerEvents={showAnswerMenu ? 'auto' : 'none'}
          >
            <TouchableOpacity style={styles.fabIcon} onPress={() => { setShowAnswerMenu(false); setShowTextComposer(true); }}>
              <Ionicons name="create-outline" size={20} color="#6C5CE7" />
            </TouchableOpacity>
            <TouchableOpacity style={styles.fabIcon} onPress={() => { setShowAnswerMenu(false); setShowVoiceComposer(true); }}>
              <Ionicons name="mic-outline" size={20} color="#FF9800" />
            </TouchableOpacity>
            <TouchableOpacity style={styles.fabIcon} onPress={() => { setShowAnswerMenu(false); openCamera(); }}>
              <Ionicons name="camera-outline" size={20} color="#E94560" />
            </TouchableOpacity>
          </Animated.View>

          <TouchableOpacity
            style={[styles.fabBtn, showAnswerMenu && styles.fabBtnOpen]}
            onPress={() => setShowAnswerMenu(!showAnswerMenu)}
            activeOpacity={0.8}
          >
            <Ionicons name={showAnswerMenu ? 'close' : 'add'} size={26} color="#FFF" />
          </TouchableOpacity>
        </View>
      )}

      {/* Composers */}
      <TextComposerModal
        visible={showTextComposer}
        prompt={prompt}
        onClose={() => setShowTextComposer(false)}
        onSubmit={handleTextSubmit}
      />

      <VoiceComposer
        visible={showVoiceComposer}
        prompt={prompt}
        onClose={() => setShowVoiceComposer(false)}
        onSubmit={handleVoiceSubmit}
      />

      {/* Connect Popup */}
      <ConnectPopup
        visible={connectPopup.visible}
        userName={connectPopup.userName}
        userPhotoUrl={connectPopup.userPhotoUrl}
        onConnect={handleConnect}
        onRemove={handleRemove}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.background },
  errorText: { color: C.textLight, textAlign: 'center', marginTop: 60, fontSize: 16 },
  // Header
  header: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 16, paddingVertical: 10,
    borderBottomWidth: 1, borderBottomColor: C.surface,
  },
  headerBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  headerBadgeText: { fontSize: 9, fontWeight: '700', color: '#FFF' },
  headerTitle: { fontSize: 17, fontWeight: '700', color: C.text },
  headerCount: { fontSize: 13, color: C.textLight },
  // Poster profile
  posterRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10,
  },
  posterAvatar: { width: 28, height: 28, borderRadius: 14, backgroundColor: C.accent },
  posterAvatarPlaceholder: {
    width: 28, height: 28, borderRadius: 14, backgroundColor: C.accent,
    alignItems: 'center', justifyContent: 'center',
  },
  posterName: { fontSize: 13, fontWeight: '600', color: C.text },
  posterAge: { fontSize: 12, color: C.textLight },
  // Prompt
  promptBox: {
    padding: 16, borderBottomWidth: 1, borderBottomColor: C.surface,
  },
  promptText: { fontSize: 16, fontWeight: '600', color: C.text, lineHeight: 24, marginBottom: 8 },
  promptStats: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  promptStatText: { fontSize: 12, color: C.textLight },
  promptStatDot: { fontSize: 12, color: C.textLight },
  // List
  listContent: { paddingBottom: 100 },
  emptyBox: { padding: 40, alignItems: 'center' },
  emptyText: { fontSize: 14, color: C.textLight },
  // Answer card
  answerCard: {
    paddingHorizontal: 16, paddingVertical: 14,
    borderBottomWidth: 1, borderBottomColor: C.surface + '40',
  },
  answerHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  answerAvatar: { width: 32, height: 32, borderRadius: 16, backgroundColor: C.accent },
  answerAvatarPlaceholder: {
    width: 32, height: 32, borderRadius: 16, backgroundColor: C.accent,
    alignItems: 'center', justifyContent: 'center',
  },
  answerInfo: { flex: 1, marginLeft: 10 },
  answerNameRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  answerName: { fontSize: 13, fontWeight: '600', color: C.text },
  answerTime: { fontSize: 11, color: C.textLight },
  // "You" badge
  youBadge: {
    backgroundColor: C.primary + '25', paddingHorizontal: 6, paddingVertical: 1, borderRadius: 6,
  },
  youBadgeText: { fontSize: 9, fontWeight: '700', color: C.primary },
  // Anonymous badge overlay (small eye-off icon on avatar)
  anonBadgeOverlay: {
    position: 'absolute', bottom: -2, right: -2,
    width: 14, height: 14, borderRadius: 7,
    backgroundColor: C.primary, alignItems: 'center', justifyContent: 'center',
  },
  // Message lock button
  msgLockBtn: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 8, paddingVertical: 5, borderRadius: 8,
    backgroundColor: C.surface, marginRight: 6,
  },
  // Gender badge (for anonymous answers)
  genderBadge: {
    backgroundColor: C.accent, paddingHorizontal: 4, paddingVertical: 2, borderRadius: 6,
  },
  // First answer badge
  firstBadge: {
    backgroundColor: '#FFD70025', paddingHorizontal: 6, paddingVertical: 1, borderRadius: 6,
    borderWidth: 1, borderColor: '#FFD70050',
  },
  firstBadgeText: { fontSize: 9, fontWeight: '700', color: '#DAA520' },
  typeBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8,
  },
  typeBadgeText: { fontSize: 10, fontWeight: '600', textTransform: 'capitalize' },
  // Text answer
  answerText: { fontSize: 14, color: C.text, lineHeight: 21, marginBottom: 6 },
  // Voice
  voiceRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6, padding: 8, backgroundColor: C.surface, borderRadius: 10 },
  voiceWaveform: { flexDirection: 'row', alignItems: 'center', gap: 2, flex: 1 },
  voiceBar: { width: 2, borderRadius: 1, backgroundColor: C.primary + '60' },
  voiceDuration: { fontSize: 12, color: C.textLight, fontWeight: '600' },
  // Media
  mediaContainer: { borderRadius: 10, overflow: 'hidden', marginBottom: 6, height: 200 },
  mediaImage: { width: '100%', height: '100%' },
  videoPlaceholder: {
    flex: 1, backgroundColor: C.accent, alignItems: 'center', justifyContent: 'center',
  },
  videoLabel: { fontSize: 12, color: '#FFF', marginTop: 4 },
  // Hidden
  hiddenMedia: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: C.surface, borderRadius: 10, padding: 14, marginBottom: 6,
  },
  hiddenText: { fontSize: 13, color: C.textLight, fontStyle: 'italic' },
  // Actions
  answerActions: { flexDirection: 'row', alignItems: 'center' },
  likeBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, padding: 4 },
  likeCount: { fontSize: 12, color: C.textLight, fontWeight: '600' },
  deleteBtn: { marginLeft: 12, padding: 4 },
  // Fixed bottom-right FAB + overlay options
  answerFab: {
    position: 'absolute', right: 16,
    alignItems: 'center',
  },
  fabBtn: {
    width: 52, height: 52, borderRadius: 26,
    backgroundColor: C.primary,
    alignItems: 'center', justifyContent: 'center',
    elevation: 4,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25, shadowRadius: 4,
  },
  fabBtnOpen: { backgroundColor: C.textLight },
  fabOptions: {
    position: 'absolute', bottom: 60,
    alignItems: 'center', gap: 10,
  },
  fabIcon: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: C.surface,
    alignItems: 'center', justifyContent: 'center',
    elevation: 3,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.2, shadowRadius: 3,
  },
});
