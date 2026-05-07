import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import UploadProgressRing from '@/components/chatroom/UploadProgressRing';
import { TruthDarePendingPromptUpload } from '@/stores/truthDarePromptUploadStore';

/*
 * PendingPromptCard
 *
 * Renders a Truth/Dare prompt that the current user has just posted but
 * which has not yet been confirmed by the backend. Visual style mirrors
 * the production PromptCard so it slots into the feed naturally, with an
 * additional progress overlay + status line. Only the posting user ever
 * sees this card — feed merging in `truth-or-dare.tsx` filters by userId.
 *
 * Status semantics:
 *   queued      -> "Waiting to upload"
 *   uploading   -> "Uploading NN%"  (real byte progress, 0-95% range)
 *   submitting  -> "Finalizing..."  (95-99% progress)
 *   success     -> "Posted"         (100% — typically replaced by real
 *                                    Convex post a tick later)
 *   failed      -> error message + Retry / Remove actions
 */

const PENDING = {
  bgElevated: '#1C1C36',
  bgHighlight: '#252545',
  borderSubtle: 'rgba(255, 255, 255, 0.06)',
  coral: '#E94560',
  coralSoft: '#FF6B8A',
  truthPurple: '#7C6AEF',
  dareOrange: '#FF7849',
  textPrimary: '#F5F5F7',
  textSecondary: '#B8B8C7',
  textMuted: '#6E6E82',
};

type PendingPromptCardProps = {
  item: TruthDarePendingPromptUpload;
  onRetry: (clientId: string) => void;
  onRemove: (clientId: string) => void;
};

function getStatusText(item: TruthDarePendingPromptUpload): string {
  switch (item.status) {
    case 'queued':
      return 'Waiting to upload';
    case 'uploading': {
      // Map raw byte progress (0-100) to a UI range of 5-95% so the user
      // never sees "100%" before the backend create mutation finishes.
      const displayProgress = Math.min(95, Math.max(5, Math.round(item.progress * 0.9 + 5)));
      return `Uploading ${displayProgress}%`;
    }
    case 'submitting':
      return 'Finalizing…';
    case 'success':
      return 'Posted';
    case 'failed':
      return item.error?.message || 'Failed to post. Tap Retry to try again.';
    default:
      return 'Uploading';
  }
}

function getDisplayProgressForRing(item: TruthDarePendingPromptUpload): number {
  if (item.status === 'queued') return 5;
  if (item.status === 'uploading') {
    return Math.min(95, Math.max(5, Math.round(item.progress * 0.9 + 5)));
  }
  if (item.status === 'submitting') return 98;
  if (item.status === 'success') return 100;
  return Math.max(5, Math.round(item.progress));
}

function getMediaIcon(
  kind: TruthDarePendingPromptUpload['attachment']['kind']
): keyof typeof Ionicons.glyphMap {
  if (kind === 'video') return 'videocam';
  if (kind === 'voice') return 'mic';
  return 'image';
}

export function PendingPromptCard({ item, onRetry, onRemove }: PendingPromptCardProps) {
  const isVisualMedia =
    item.attachment.kind === 'photo' || item.attachment.kind === 'video';
  const isFailed = item.status === 'failed';
  const canRetry = !isFailed || item.error?.retryable !== false;
  const isActive =
    item.status === 'queued' ||
    item.status === 'uploading' ||
    item.status === 'submitting';
  const ownerLabel = item.isAnonymous ? 'Anonymous' : item.ownerName || 'You';
  const mediaIcon = getMediaIcon(item.attachment.kind);
  const typeAccent = item.type === 'dare' ? PENDING.dareOrange : PENDING.truthPurple;

  return (
    <TouchableOpacity
      style={styles.wrapper}
      activeOpacity={isFailed && canRetry ? 0.85 : 1}
      onPress={() => {
        if (isFailed && canRetry) onRetry(item.clientId);
      }}
    >
      <View
        style={[
          styles.card,
          isFailed && styles.cardFailed,
          { borderLeftColor: isFailed ? PENDING.textSecondary : `${typeAccent}88` },
        ]}
      >
        <View style={styles.header}>
          <View style={styles.avatar}>
            <Ionicons
              name={item.isAnonymous ? 'eye-off' : 'person'}
              size={16}
              color={PENDING.textMuted}
            />
          </View>
          <View style={styles.headerText}>
            <Text style={styles.authorName} numberOfLines={1} maxFontSizeMultiplier={1.2}>
              {ownerLabel}
            </Text>
            <View style={styles.metaRow}>
              <View style={[styles.typeBadge, { backgroundColor: `${typeAccent}33` }]}>
                <Text
                  style={[styles.typeBadgeText, { color: typeAccent }]}
                  maxFontSizeMultiplier={1.15}
                >
                  {item.type === 'dare' ? 'DARE' : 'TRUTH'}
                </Text>
              </View>
              <Text style={styles.pendingLabel} numberOfLines={1} maxFontSizeMultiplier={1.15}>
                Posting…
              </Text>
            </View>
          </View>
        </View>

        <Text style={styles.promptText} numberOfLines={4} maxFontSizeMultiplier={1.2}>
          {item.text}
        </Text>

        <View style={styles.mediaTile}>
          {isVisualMedia ? (
            <Image
              source={{ uri: item.attachment.localUri }}
              style={StyleSheet.absoluteFillObject}
              contentFit="cover"
              transition={120}
            />
          ) : (
            <LinearGradient
              colors={[PENDING.bgHighlight, PENDING.bgElevated] as const}
              start={{ x: 0.5, y: 0 }}
              end={{ x: 0.5, y: 1 }}
              style={StyleSheet.absoluteFillObject}
            />
          )}
          <View style={styles.mediaScrim} />
          <View style={styles.mediaIconChip}>
            <Ionicons name={mediaIcon} size={14} color="#FFF" />
          </View>
          {isActive && (
            <View style={styles.progressOverlay}>
              <UploadProgressRing
                progress={getDisplayProgressForRing(item)}
                size={56}
                strokeWidth={5}
              />
            </View>
          )}
          {isFailed && (
            <View style={styles.failedOverlay}>
              <Ionicons
                name={canRetry ? 'refresh' : 'alert-circle-outline'}
                size={22}
                color="#FFF"
              />
            </View>
          )}
        </View>

        <Text
          style={[styles.statusText, isFailed && styles.statusTextFailed]}
          numberOfLines={2}
          maxFontSizeMultiplier={1.2}
        >
          {getStatusText(item)}
        </Text>

        {isFailed && (
          <View style={styles.failedActions}>
            {canRetry && (
              <TouchableOpacity
                style={styles.retryBtn}
                onPress={() => onRetry(item.clientId)}
                activeOpacity={0.85}
                accessibilityRole="button"
                accessibilityLabel="Retry posting"
              >
                <Ionicons name="refresh" size={13} color="#FFF" />
                <Text style={styles.retryText} maxFontSizeMultiplier={1.15}>Retry</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity
              style={styles.removeBtn}
              onPress={() => onRemove(item.clientId)}
              activeOpacity={0.85}
              accessibilityRole="button"
              accessibilityLabel="Remove pending post"
            >
              <Text style={styles.removeText} maxFontSizeMultiplier={1.15}>Remove</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    marginHorizontal: 16,
    marginBottom: 12,
  },
  card: {
    backgroundColor: PENDING.bgElevated,
    borderRadius: 18,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderWidth: 1,
    borderColor: PENDING.borderSubtle,
    borderLeftWidth: 3,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.22,
    shadowRadius: 10,
    elevation: 3,
  },
  cardFailed: {
    opacity: 0.94,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: PENDING.bgHighlight,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: PENDING.borderSubtle,
  },
  headerText: {
    flex: 1,
    marginLeft: 10,
    minWidth: 0,
  },
  authorName: {
    fontSize: 14,
    fontWeight: '700',
    color: PENDING.textPrimary,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 3,
    gap: 8,
  },
  typeBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
  },
  typeBadgeText: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.6,
  },
  pendingLabel: {
    fontSize: 11,
    color: PENDING.textMuted,
    fontWeight: '600',
  },
  promptText: {
    fontSize: 16,
    lineHeight: 22,
    color: PENDING.textPrimary,
    marginBottom: 12,
  },
  mediaTile: {
    width: '100%',
    aspectRatio: 16 / 10,
    borderRadius: 14,
    overflow: 'hidden',
    backgroundColor: PENDING.bgHighlight,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: PENDING.borderSubtle,
  },
  mediaScrim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.32)',
  },
  mediaIconChip: {
    position: 'absolute',
    top: 10,
    left: 10,
    width: 26,
    height: 26,
    borderRadius: 8,
    backgroundColor: 'rgba(13, 13, 26, 0.7)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  progressOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  failedOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.32)',
  },
  statusText: {
    marginTop: 10,
    fontSize: 12,
    fontWeight: '700',
    color: PENDING.coralSoft,
    letterSpacing: 0.3,
  },
  statusTextFailed: {
    color: PENDING.textSecondary,
  },
  failedActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 10,
  },
  retryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: PENDING.coral,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  retryText: {
    fontSize: 12,
    fontWeight: '800',
    color: '#FFF',
  },
  removeBtn: {
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 7,
    backgroundColor: PENDING.bgHighlight,
    borderWidth: 1,
    borderColor: PENDING.borderSubtle,
  },
  removeText: {
    fontSize: 12,
    fontWeight: '700',
    color: PENDING.textSecondary,
  },
});
