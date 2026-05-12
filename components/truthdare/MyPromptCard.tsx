import React, { memo, useMemo } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { getTimeAgo } from '@/lib/utils';

const PREMIUM = {
  bgElevated: '#1C1C36',
  bgHighlight: '#252545',
  coral: '#E94560',
  coralSoft: '#FF6B8A',
  truthPurple: '#7C6AEF',
  truthPurpleSoft: '#9D8DF7',
  dareOrange: '#FF7849',
  dareOrangeSoft: '#FF9A76',
  textPrimary: '#F5F5F7',
  textSecondary: '#B8B8C7',
  textMuted: '#6E6E82',
  borderSubtle: 'rgba(255, 255, 255, 0.06)',
};

type MyPromptStatus = 'normal' | 'under_review' | 'hidden_by_reports';

export type MyTruthDarePrompt = {
  _id: string;
  type: 'truth' | 'dare';
  text: string;
  createdAt: number;
  expiresAt?: number;
  isExpired?: boolean;
  answerCount?: number;
  visibleAnswerCount?: number;
  photoCount?: number;
  videoCount?: number;
  totalMediaCount?: number;
  totalReactionCount?: number;
  moderationStatus?: MyPromptStatus;
  hiddenByReportsAt?: number;
  moderationStatusAt?: number;
  editedAt?: number;
  hasMedia?: boolean;
};

type Props = {
  prompt: MyTruthDarePrompt;
  onPress: (promptId: string) => void;
};

function pluralize(count: number, singular: string): string {
  return `${count} ${singular}${count === 1 ? '' : 's'}`;
}

function formatShortDate(timestamp?: number): string {
  if (!timestamp) return '';
  return new Date(timestamp).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  });
}

function formatMediaSummary(prompt: MyTruthDarePrompt): string | null {
  const photoCount = prompt.photoCount ?? 0;
  const videoCount = prompt.videoCount ?? 0;
  const totalMediaCount = prompt.totalMediaCount ?? 0;
  if (totalMediaCount <= 0) return null;

  const parts: string[] = [];
  if (photoCount > 0) parts.push(pluralize(photoCount, 'photo'));
  if (videoCount > 0) parts.push(pluralize(videoCount, 'video'));
  const otherMediaCount = Math.max(0, totalMediaCount - photoCount - videoCount);
  if (otherMediaCount > 0) parts.push(pluralize(otherMediaCount, 'media file'));
  return parts.length > 0 ? parts.join(' • ') : pluralize(totalMediaCount, 'media file');
}

function getStatus(prompt: MyTruthDarePrompt): {
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  color: string;
} {
  if (prompt.moderationStatus === 'hidden_by_reports') {
    return { label: 'Hidden', icon: 'eye-off-outline', color: '#F59E0B' };
  }
  if (prompt.moderationStatus === 'under_review') {
    return { label: 'Under review', icon: 'shield-outline', color: '#F5A623' };
  }
  if (prompt.isExpired) {
    const date = formatShortDate(prompt.expiresAt ?? prompt.createdAt);
    return {
      label: date ? `Expired • ${date}` : 'Expired',
      icon: 'time-outline',
      color: PREMIUM.textMuted,
    };
  }
  return { label: 'Active', icon: 'radio-button-on', color: '#61D394' };
}

export const MyPromptCard = memo(function MyPromptCard({ prompt, onPress }: Props) {
  const isTruth = prompt.type === 'truth';
  const status = useMemo(() => getStatus(prompt), [prompt]);
  const answerCount = prompt.answerCount ?? 0;
  const reactionCount = prompt.totalReactionCount ?? 0;
  const mediaSummary = formatMediaSummary(prompt);
  const postedLabel = prompt.isExpired
    ? `Posted ${formatShortDate(prompt.createdAt)}`
    : getTimeAgo(prompt.createdAt);

  return (
    <TouchableOpacity
      style={styles.card}
      activeOpacity={0.86}
      onPress={() => onPress(String(prompt._id))}
    >
      <View style={styles.topRow}>
        <LinearGradient
          colors={
            isTruth
              ? [PREMIUM.truthPurple, PREMIUM.truthPurpleSoft] as const
              : [PREMIUM.dareOrange, PREMIUM.dareOrangeSoft] as const
          }
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.typePill}
        >
          <Ionicons name={isTruth ? 'help-circle' : 'flash'} size={12} color="#FFF" />
          <Text style={styles.typeText} maxFontSizeMultiplier={1.15}>
            {isTruth ? 'Truth' : 'Dare'}
          </Text>
        </LinearGradient>

        <View style={styles.statusPill}>
          <Ionicons name={status.icon} size={12} color={status.color} />
          <Text
            style={[styles.statusText, { color: status.color }]}
            numberOfLines={1}
            maxFontSizeMultiplier={1.15}
          >
            {status.label}
          </Text>
        </View>
      </View>

      <Text style={styles.promptText} numberOfLines={3} maxFontSizeMultiplier={1.2}>
        {prompt.text}
      </Text>

      <View style={styles.metaRow}>
        <View style={styles.metaItem}>
          <Ionicons name="time-outline" size={13} color={PREMIUM.textMuted} />
          <Text style={styles.metaText} maxFontSizeMultiplier={1.15}>{postedLabel}</Text>
        </View>
        <View style={styles.metaItem}>
          <Ionicons name="chatbubble-outline" size={13} color={PREMIUM.textMuted} />
          <Text style={styles.metaText} maxFontSizeMultiplier={1.15}>{pluralize(answerCount, 'response')}</Text>
        </View>
        <View style={styles.metaItem}>
          <Ionicons name="heart-outline" size={13} color={PREMIUM.textMuted} />
          <Text style={styles.metaText} maxFontSizeMultiplier={1.15}>{pluralize(reactionCount, 'reaction')}</Text>
        </View>
        {mediaSummary ? (
          <View style={styles.metaItem}>
            <Ionicons name="images-outline" size={13} color={PREMIUM.textMuted} />
            <Text style={styles.metaText} maxFontSizeMultiplier={1.15}>{mediaSummary}</Text>
          </View>
        ) : null}
      </View>
    </TouchableOpacity>
  );
});

const styles = StyleSheet.create({
  card: {
    marginHorizontal: 16,
    marginBottom: 12,
    padding: 16,
    borderRadius: 20,
    backgroundColor: PREMIUM.bgElevated,
    borderWidth: 1,
    borderColor: PREMIUM.borderSubtle,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.24,
    shadowRadius: 18,
    elevation: 4,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    marginBottom: 12,
  },
  typePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
  },
  typeText: {
    color: '#FFF',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.25,
  },
  statusPill: {
    maxWidth: '58%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: PREMIUM.bgHighlight,
  },
  statusText: {
    fontSize: 11,
    fontWeight: '700',
  },
  promptText: {
    color: PREMIUM.textPrimary,
    fontSize: 16,
    lineHeight: 22,
    fontWeight: '700',
    marginBottom: 14,
  },
  metaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 10,
  },
  metaItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  metaText: {
    color: PREMIUM.textSecondary,
    fontSize: 12,
    fontWeight: '600',
  },
});
