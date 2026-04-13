/**
 * CONFESSION THREAD - PREMIUM UI
 * Matches the visual language of the Confession homepage.
 * Uses same colors, spacing, typography, and card styling patterns.
 */
import React, { useCallback, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMutation, useQuery } from 'convex/react';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';

import { api } from '@/convex/_generated/api';
import { COLORS, moderateScale } from '@/lib/constants';
import { isContentClean } from '@/lib/contentFilter';
import { isDemoMode } from '@/hooks/useConvex';
import { useAuthStore } from '@/stores/authStore';
import { useConfessionStore } from '@/stores/confessionStore';

type Reply = {
  _id: string;
  confessionId: string;
  userId: string;
  text: string;
  isAnonymous: boolean;
  type?: string;
  voiceUrl?: string;
  voiceDurationSec?: number;
  createdAt: number;
};

type Confession = {
  _id: string;
  userId: string;
  text: string;
  isAnonymous: boolean;
  authorVisibility?: 'anonymous' | 'open' | 'blur_photo';
  mood: string;
  authorName?: string;
  authorPhotoUrl?: string;
  authorAge?: number;
  authorGender?: string;
  replyCount: number;
  reactionCount: number;
  createdAt: number;
  expiresAt?: number;
};

// Match homepage avatar size
const AVATAR_SIZE = moderateScale(22, 0.3);
const AVATAR_SIZE_LARGE = moderateScale(36, 0.3);

function formatTimeAgo(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp;
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  return `${days}d ago`;
}

export default function ConfessionThreadScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { confessionId } = useLocalSearchParams<{ confessionId: string }>();
  const userId = useAuthStore((s) => s.userId);
  const currentUserId = isDemoMode ? (userId || 'demo_user_1') : userId;

  // Demo mode stores
  const demoConfessions = useConfessionStore((s) => s.confessions);
  const demoReplies = useConfessionStore((s) => s.replies);
  const demoAddReply = useConfessionStore((s) => s.addReply);

  // Convex queries - only run in non-demo mode
  const convexConfession = useQuery(
    api.confessions.getConfession,
    !isDemoMode && confessionId ? { confessionId: confessionId as any } : 'skip'
  );
  const convexReplies = useQuery(
    api.confessions.getReplies,
    !isDemoMode && confessionId ? { confessionId: confessionId as any } : 'skip'
  );
  const createReplyMutation = useMutation(api.confessions.createReply);

  // Local state
  const [replyText, setReplyText] = useState('');
  const [isAnonymousReply, setIsAnonymousReply] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const inputRef = useRef<TextInput>(null);

  // Get confession data
  const confession: Confession | null = isDemoMode
    ? (demoConfessions.find((c) => c.id === confessionId) as unknown as Confession | undefined) ?? null
    : convexConfession ?? null;

  // Get replies
  const replies: Reply[] = isDemoMode
    ? (demoReplies[confessionId ?? ''] ?? []).map((r: any) => ({
        _id: r.id,
        confessionId: confessionId ?? '',
        userId: r.userId,
        text: r.text,
        isAnonymous: r.isAnonymous,
        type: r.type,
        voiceUrl: r.voiceUrl,
        voiceDurationSec: r.voiceDurationSec,
        createdAt: r.createdAt,
      }))
    : (convexReplies ?? []);

  const isLoading = !isDemoMode && (convexConfession === undefined || convexReplies === undefined);

  const handleBack = useCallback(() => {
    router.back();
  }, [router]);

  const handleSubmitReply = useCallback(async () => {
    if (!currentUserId || !confessionId || submitting) return;

    const trimmed = replyText.trim();
    if (trimmed.length < 1) {
      Alert.alert('Empty Reply', 'Please write something.');
      return;
    }

    if (!isContentClean(trimmed)) {
      Alert.alert('Content Warning', 'Your reply contains inappropriate content.');
      return;
    }

    setSubmitting(true);
    Keyboard.dismiss();

    try {
      if (isDemoMode) {
        demoAddReply(confessionId, {
          id: `reply_${Date.now()}`,
          confessionId,
          userId: currentUserId,
          text: trimmed,
          isAnonymous: isAnonymousReply,
          type: 'text',
          createdAt: Date.now(),
        });
      } else {
        await createReplyMutation({
          confessionId: confessionId as any,
          userId: currentUserId,
          text: trimmed,
          isAnonymous: isAnonymousReply,
          type: 'text',
        });
      }

      setReplyText('');
    } catch (error: any) {
      Alert.alert('Error', error?.message || 'Failed to post reply');
    } finally {
      setSubmitting(false);
    }
  }, [
    confessionId,
    createReplyMutation,
    currentUserId,
    demoAddReply,
    isAnonymousReply,
    replyText,
    submitting,
  ]);

  const renderReplyItem = useCallback(({ item }: { item: Reply }) => {
    const isOwnReply = item.userId === currentUserId;

    return (
      <View style={[styles.replyCard, isOwnReply && styles.replyCardOwn]}>
        <View style={styles.replyHeader}>
          <View style={[styles.replyAvatar, isOwnReply && styles.replyAvatarOwn]}>
            <Ionicons
              name={item.isAnonymous ? 'eye-off' : 'person'}
              size={10}
              color={isOwnReply ? COLORS.primary : COLORS.textMuted}
            />
          </View>
          <Text style={[styles.replyAuthor, isOwnReply && styles.replyAuthorOwn]}>
            {item.isAnonymous ? 'Anonymous' : 'Someone'}
            {isOwnReply && ' (You)'}
          </Text>
          <Text style={styles.replyTime}>{formatTimeAgo(item.createdAt)}</Text>
        </View>
        <Text style={styles.replyText}>{item.text}</Text>
      </View>
    );
  }, [currentUserId]);

  const renderHeader = useCallback(() => {
    if (!confession) return null;

    // Determine effective visibility mode (same logic as ConfessionCard)
    const effectiveVisibility = confession.authorVisibility || (confession.isAnonymous ? 'anonymous' : 'open');
    const isFullyAnonymous = effectiveVisibility === 'anonymous';
    const isBlurPhoto = effectiveVisibility === 'blur_photo' || (effectiveVisibility as string) === 'blur';

    // Build display name with age and gender (same logic as ConfessionCard)
    const getDisplayName = (): string => {
      if (isFullyAnonymous) return 'Anonymous';
      if (!confession.authorName) return 'Someone';
      let name = confession.authorName;
      if (confession.authorAge) {
        name += `, ${confession.authorAge}`;
      }
      if (confession.authorGender) {
        const genderLabel = confession.authorGender === 'male' ? 'M'
          : confession.authorGender === 'female' ? 'F'
          : confession.authorGender === 'non_binary' ? 'NB'
          : confession.authorGender === 'lesbian' ? 'F' : '';
        if (genderLabel) name += ` ${genderLabel}`;
      }
      return name;
    };

    return (
      <View style={styles.headerSection}>
        {/* Hero confession card - matches ConfessionCard component styling */}
        <View style={styles.confessionCard}>
          {/* Author row - matches homepage card */}
          <View style={styles.authorRow}>
            {isFullyAnonymous ? (
              <View style={[styles.avatar, styles.avatarAnonymous]}>
                <Ionicons name="eye-off" size={12} color={COLORS.textMuted} />
              </View>
            ) : isBlurPhoto && confession.authorPhotoUrl ? (
              <Image
                source={{ uri: confession.authorPhotoUrl }}
                style={styles.avatarImage}
                contentFit="cover"
                blurRadius={20}
              />
            ) : confession.authorPhotoUrl ? (
              <Image
                source={{ uri: confession.authorPhotoUrl }}
                style={styles.avatarImage}
                contentFit="cover"
              />
            ) : (
              <View style={styles.avatar}>
                <Ionicons name="person" size={12} color={COLORS.primary} />
              </View>
            )}
            <Text style={[styles.authorName, !isFullyAnonymous && styles.authorNamePublic]}>
              {getDisplayName()}
            </Text>
            <Text style={styles.timeAgo}>{formatTimeAgo(confession.createdAt)}</Text>
          </View>

          {/* Confession body - matches homepage text styling */}
          <Text style={styles.confessionText}>{confession.text}</Text>

          {/* Stats row - matches homepage metadata styling */}
          <View style={styles.statsRow}>
            <View style={styles.statItem}>
              <Ionicons name="chatbubble-outline" size={14} color={COLORS.textMuted} />
              <Text style={styles.statCount}>{confession.replyCount}</Text>
              <Text style={styles.statLabel}>{confession.replyCount === 1 ? 'Reply' : 'Replies'}</Text>
            </View>
            <View style={styles.statItem}>
              <Ionicons name="heart-outline" size={14} color={COLORS.textMuted} />
              <Text style={styles.statCount}>{confession.reactionCount}</Text>
              <Text style={styles.statLabel}>{confession.reactionCount === 1 ? 'Reaction' : 'Reactions'}</Text>
            </View>
          </View>
        </View>

        {/* Replies section header */}
        {replies.length > 0 && (
          <View style={styles.repliesSectionHeader}>
            <Text style={styles.repliesSectionTitle}>
              {replies.length} {replies.length === 1 ? 'Reply' : 'Replies'}
            </Text>
          </View>
        )}
      </View>
    );
  }, [confession, replies.length]);

  const renderEmpty = useCallback(() => {
    if (isLoading) return null;
    return (
      <View style={styles.emptyContainer}>
        <View style={styles.emptyIconWrap}>
          <Ionicons name="chatbubbles-outline" size={40} color={COLORS.textMuted} />
        </View>
        <Text style={styles.emptyTitle}>No replies yet</Text>
        <Text style={styles.emptySubtitle}>Be the first to share your thoughts</Text>
      </View>
    );
  }, [isLoading]);

  // Loading state
  if (isLoading) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.header}>
          <TouchableOpacity onPress={handleBack} hitSlop={8}>
            <Ionicons name="chevron-back" size={24} color={COLORS.text} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Thread</Text>
          <View style={{ width: 24 }} />
        </View>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={COLORS.primary} />
          <Text style={styles.loadingText}>Loading thread...</Text>
        </View>
      </SafeAreaView>
    );
  }

  // Error state - confession not found
  if (!confession) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.header}>
          <TouchableOpacity onPress={handleBack} hitSlop={8}>
            <Ionicons name="chevron-back" size={24} color={COLORS.text} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Thread</Text>
          <View style={{ width: 24 }} />
        </View>
        <View style={styles.errorContainer}>
          <View style={styles.errorIconWrap}>
            <Ionicons name="alert-circle-outline" size={48} color={COLORS.textMuted} />
          </View>
          <Text style={styles.errorTitle}>Not Found</Text>
          <Text style={styles.errorSubtitle}>This confession may have expired or been removed.</Text>
          <TouchableOpacity style={styles.errorButton} onPress={handleBack}>
            <Text style={styles.errorButtonText}>Go Back</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.keyboardContainer}
        keyboardVerticalOffset={0}
      >
        {/* Header - matches homepage style */}
        <View style={styles.header}>
          <TouchableOpacity onPress={handleBack} hitSlop={8}>
            <Ionicons name="chevron-back" size={24} color={COLORS.text} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Thread</Text>
          <View style={{ width: 24 }} />
        </View>

        {/* Replies list with confession as header */}
        <FlatList
          data={replies}
          keyExtractor={(item) => item._id}
          renderItem={renderReplyItem}
          ListHeaderComponent={renderHeader}
          ListEmptyComponent={renderEmpty}
          contentContainerStyle={[
            styles.listContent,
            { paddingBottom: insets.bottom + 96 },
          ]}
          showsVerticalScrollIndicator={false}
        />

        {/* Reply input - hidden for confession owner */}
        {confession.userId === currentUserId ? (
          <View style={[styles.ownerNotice, { paddingBottom: Math.max(insets.bottom, 16) }]}>
            <View style={styles.ownerNoticeInner}>
              <View style={styles.ownerNoticeIcon}>
                <Ionicons name="eye-outline" size={14} color={COLORS.textMuted} />
              </View>
              <Text style={styles.ownerNoticeText}>
                This is your confession. You can view replies but cannot respond.
              </Text>
            </View>
          </View>
        ) : (
          <View style={[styles.composerContainer, { paddingBottom: Math.max(insets.bottom, 12) }]}>
            <View style={styles.composerRow}>
              {/* Anonymous toggle */}
              <TouchableOpacity
                style={[styles.anonToggle, isAnonymousReply && styles.anonToggleActive]}
                onPress={() => setIsAnonymousReply(!isAnonymousReply)}
                activeOpacity={0.7}
              >
                <Ionicons
                  name={isAnonymousReply ? 'eye-off' : 'eye'}
                  size={16}
                  color={isAnonymousReply ? COLORS.white : COLORS.textMuted}
                />
              </TouchableOpacity>

              {/* Text input */}
              <TextInput
                ref={inputRef}
                style={styles.textInput}
                placeholder={isAnonymousReply ? 'Reply anonymously...' : 'Write a reply...'}
                placeholderTextColor={COLORS.textMuted}
                value={replyText}
                onChangeText={setReplyText}
                multiline
                maxLength={500}
              />

              {/* Send button */}
              <TouchableOpacity
                style={[
                  styles.sendButton,
                  (!replyText.trim() || submitting) && styles.sendButtonDisabled,
                ]}
                onPress={handleSubmitReply}
                disabled={!replyText.trim() || submitting}
                activeOpacity={0.8}
              >
                {submitting ? (
                  <ActivityIndicator size="small" color={COLORS.white} />
                ) : (
                  <Ionicons name="arrow-up" size={18} color={COLORS.white} />
                )}
              </TouchableOpacity>
            </View>

            {/* Anonymous hint */}
            <Text style={styles.composerHint}>
              {isAnonymousReply ? 'Replying anonymously' : 'Your name will be visible'}
            </Text>
          </View>
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  // ─────────────────────────────────────────────────────────────
  // Container & Layout - matches homepage
  // ─────────────────────────────────────────────────────────────
  container: {
    flex: 1,
    backgroundColor: COLORS.backgroundDark, // Same as homepage
  },
  keyboardContainer: {
    flex: 1,
  },
  listContent: {
    paddingTop: 8,
  },

  // ─────────────────────────────────────────────────────────────
  // Header - matches homepage header style
  // ─────────────────────────────────────────────────────────────
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.border,
    backgroundColor: COLORS.backgroundDark,
  },
  headerTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: COLORS.text,
  },

  // ─────────────────────────────────────────────────────────────
  // Loading State
  // ─────────────────────────────────────────────────────────────
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 12,
  },
  loadingText: {
    fontSize: 16,
    color: COLORS.textLight,
  },

  // ─────────────────────────────────────────────────────────────
  // Error State
  // ─────────────────────────────────────────────────────────────
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 40,
  },
  errorIconWrap: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: 'rgba(153,153,153,0.1)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  errorTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: COLORS.text,
    marginBottom: 8,
  },
  errorSubtitle: {
    fontSize: 15,
    lineHeight: 22,
    color: COLORS.textLight,
    textAlign: 'center',
    marginBottom: 24,
  },
  errorButton: {
    borderRadius: 24,
    paddingHorizontal: 24,
    paddingVertical: 12,
    backgroundColor: COLORS.primary,
  },
  errorButtonText: {
    fontSize: 15,
    fontWeight: '600',
    color: COLORS.white,
  },

  // ─────────────────────────────────────────────────────────────
  // Header Section
  // ─────────────────────────────────────────────────────────────
  headerSection: {
    paddingBottom: 4,
  },

  // ─────────────────────────────────────────────────────────────
  // Confession Card - matches ConfessionCard component exactly
  // ─────────────────────────────────────────────────────────────
  confessionCard: {
    backgroundColor: COLORS.background,
    borderRadius: 16,
    paddingHorizontal: 18,
    paddingTop: 16,
    paddingBottom: 14,
    marginHorizontal: 12,
    marginVertical: 6,
    // Shadow for iOS - matches homepage
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    // Elevation for Android
    elevation: 3,
  },
  authorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 10,
    minHeight: 26,
  },
  avatar: {
    width: AVATAR_SIZE,
    height: AVATAR_SIZE,
    borderRadius: AVATAR_SIZE / 2,
    backgroundColor: 'rgba(255,107,107,0.12)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarImage: {
    width: AVATAR_SIZE,
    height: AVATAR_SIZE,
    borderRadius: AVATAR_SIZE / 2,
  },
  avatarAnonymous: {
    backgroundColor: 'rgba(153,153,153,0.12)',
  },
  authorName: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.textLight,
    flex: 1,
  },
  authorNamePublic: {
    color: COLORS.primary,
  },
  timeAgo: {
    fontSize: 12,
    color: COLORS.textMuted,
  },
  confessionText: {
    fontSize: 16,
    fontWeight: '500',
    lineHeight: 24,
    color: COLORS.text,
    marginBottom: 14,
    letterSpacing: 0.1,
  },
  statsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
    paddingTop: 12,
    marginTop: 6,
  },
  statItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  statCount: {
    fontSize: 13,
    color: COLORS.textMuted,
    fontWeight: '500',
  },
  statLabel: {
    fontSize: 13,
    color: COLORS.textMuted,
  },

  // ─────────────────────────────────────────────────────────────
  // Replies Section Header
  // ─────────────────────────────────────────────────────────────
  repliesSectionHeader: {
    paddingHorizontal: 20,
    paddingVertical: 14,
  },
  repliesSectionTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.textLight,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },

  // ─────────────────────────────────────────────────────────────
  // Reply Cards - similar card styling as homepage
  // ─────────────────────────────────────────────────────────────
  replyCard: {
    backgroundColor: COLORS.background,
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 12,
    marginHorizontal: 12,
    marginBottom: 8,
    // Shadow for iOS
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    // Elevation for Android
    elevation: 2,
  },
  replyCardOwn: {
    borderLeftWidth: 3,
    borderLeftColor: COLORS.primary,
  },
  replyHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  replyAvatar: {
    width: moderateScale(18, 0.3),
    height: moderateScale(18, 0.3),
    borderRadius: moderateScale(9, 0.3),
    backgroundColor: 'rgba(153,153,153,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  replyAvatarOwn: {
    backgroundColor: 'rgba(255,107,107,0.12)',
  },
  replyAuthor: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.textLight,
    flex: 1,
  },
  replyAuthorOwn: {
    color: COLORS.primary,
  },
  replyTime: {
    fontSize: 12,
    color: COLORS.textMuted,
  },
  replyText: {
    fontSize: 15,
    lineHeight: 22,
    color: COLORS.text,
    paddingLeft: moderateScale(26, 0.3),
  },

  // ─────────────────────────────────────────────────────────────
  // Empty State - matches homepage empty state styling
  // ─────────────────────────────────────────────────────────────
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 40,
    paddingTop: 56,
  },
  emptyIconWrap: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: 'rgba(153,153,153,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: COLORS.text,
    marginBottom: 8,
  },
  emptySubtitle: {
    fontSize: 15,
    lineHeight: 22,
    color: COLORS.textLight,
    textAlign: 'center',
  },

  // ─────────────────────────────────────────────────────────────
  // Owner Notice - styled as subtle info card
  // ─────────────────────────────────────────────────────────────
  ownerNotice: {
    backgroundColor: COLORS.background,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: COLORS.border,
    paddingHorizontal: 12,
    paddingTop: 12,
  },
  ownerNoticeInner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(153,153,153,0.08)',
    borderRadius: 12,
    padding: 12,
    gap: 10,
  },
  ownerNoticeIcon: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: COLORS.background,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ownerNoticeText: {
    flex: 1,
    fontSize: 13,
    color: COLORS.textLight,
    lineHeight: 18,
  },

  // ─────────────────────────────────────────────────────────────
  // Reply Composer - matches homepage styling
  // ─────────────────────────────────────────────────────────────
  composerContainer: {
    backgroundColor: COLORS.background,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: COLORS.border,
    paddingHorizontal: 12,
    paddingTop: 10,
  },
  composerRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
  },
  anonToggle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: COLORS.backgroundDark,
    alignItems: 'center',
    justifyContent: 'center',
  },
  anonToggleActive: {
    backgroundColor: COLORS.primary,
  },
  textInput: {
    flex: 1,
    backgroundColor: COLORS.backgroundDark,
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 10,
    fontSize: 14,
    color: COLORS.text,
    maxHeight: 100,
  },
  sendButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: COLORS.primary,
    alignItems: 'center',
    justifyContent: 'center',
    // Shadow for depth
    shadowColor: COLORS.primary,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 2,
  },
  sendButtonDisabled: {
    backgroundColor: COLORS.border,
    shadowOpacity: 0,
    elevation: 0,
  },
  composerHint: {
    fontSize: 11,
    color: COLORS.textMuted,
    marginTop: 6,
    marginLeft: 46,
    marginBottom: 2,
  },
});
