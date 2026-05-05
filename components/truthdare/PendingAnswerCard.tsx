import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import UploadProgressRing from '@/components/chatroom/UploadProgressRing';
import { TruthDarePendingUpload } from '@/stores/truthDareUploadStore';

const PENDING = {
  bgElevated: '#1C1C36',
  bgHighlight: '#252545',
  borderSubtle: 'rgba(255, 255, 255, 0.06)',
  coral: '#E94560',
  coralSoft: '#FF6B8A',
  textPrimary: '#F5F5F7',
  textSecondary: '#B8B8C7',
  textMuted: '#6E6E82',
};

type PendingAnswerCardProps = {
  item: TruthDarePendingUpload;
  onRetry: (clientId: string) => void;
  onRemove: (clientId: string) => void;
};

function getStatusText(item: TruthDarePendingUpload): string {
  switch (item.status) {
    case 'queued':
      return 'Waiting to upload';
    case 'uploading':
      return `Uploading ${Math.round(item.progress)}%`;
    case 'submitting':
      return 'Saving...';
    case 'success':
      return 'Posted';
    case 'failed':
      return 'Failed - Tap to retry';
    default:
      return 'Uploading';
  }
}

function getMediaIcon(kind: TruthDarePendingUpload['mediaKind']): keyof typeof Ionicons.glyphMap {
  if (kind === 'video') return 'videocam';
  if (kind === 'voice' || kind === 'audio') return 'mic';
  return 'image';
}

export function PendingAnswerCard({ item, onRetry, onRemove }: PendingAnswerCardProps) {
  const hasMedia = !!item.attachment?.localUri;
  const isVisualMedia = item.mediaKind === 'photo' || item.mediaKind === 'video';
  const isFailed = item.status === 'failed';
  const isActive = item.status === 'queued' || item.status === 'uploading' || item.status === 'submitting';
  const authorLabel = item.isAnonymous ? 'Anonymous' : item.authorName || 'You';
  const mediaIcon = getMediaIcon(item.mediaKind);

  return (
    <TouchableOpacity
      style={styles.wrapper}
      activeOpacity={isFailed ? 0.85 : 1}
      onPress={() => {
        if (isFailed) onRetry(item.clientId);
      }}
    >
      <View style={[styles.card, isFailed && styles.cardFailed]}>
        <View style={styles.header}>
          <View style={styles.avatar}>
            <Ionicons
              name={item.isAnonymous ? 'person-outline' : 'person'}
              size={16}
              color={PENDING.textMuted}
            />
          </View>
          <View style={styles.headerText}>
            <Text style={styles.authorName} numberOfLines={1}>
              {authorLabel}
            </Text>
            <Text style={styles.pendingLabel} numberOfLines={1}>
              Pending answer
            </Text>
          </View>
        </View>

        <View style={[styles.bodyRow, !hasMedia && styles.bodyRowNoTile]}>
          <View style={styles.textColumn}>
            {item.text?.trim() ? (
              <Text style={styles.answerText} numberOfLines={4}>
                {item.text.trim()}
              </Text>
            ) : (
              <Text style={styles.answerTextMuted} numberOfLines={2}>
                {hasMedia ? 'Media answer' : 'Text answer'}
              </Text>
            )}
            <Text
              style={[
                styles.statusText,
                isFailed && styles.statusTextFailed,
              ]}
              numberOfLines={1}
            >
              {item.error?.message && isFailed ? getStatusText(item) : getStatusText(item)}
            </Text>
          </View>

          {hasMedia && (
            <View style={[styles.mediaTile, isFailed && styles.mediaTileFailed]}>
              {isVisualMedia ? (
                <Image
                  source={{ uri: item.attachment?.localUri }}
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
                <Ionicons name={mediaIcon} size={16} color="#FFF" />
              </View>
              {isActive && (
                <View style={styles.progressOverlay}>
                  <UploadProgressRing
                    progress={item.status === 'submitting' ? 100 : item.progress}
                    size={42}
                    strokeWidth={4}
                  />
                </View>
              )}
              {isFailed && (
                <View style={styles.failedOverlay}>
                  <Ionicons name="refresh" size={18} color="#FFF" />
                </View>
              )}
            </View>
          )}
        </View>

        {isFailed && (
          <View style={styles.failedActions}>
            <TouchableOpacity
              style={styles.retryBtn}
              onPress={() => onRetry(item.clientId)}
              activeOpacity={0.85}
            >
              <Ionicons name="refresh" size={13} color="#FFF" />
              <Text style={styles.retryText}>Retry</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.removeBtn}
              onPress={() => onRemove(item.clientId)}
              activeOpacity={0.85}
            >
              <Text style={styles.removeText}>Remove</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    marginBottom: 10,
  },
  card: {
    backgroundColor: PENDING.bgElevated,
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: PENDING.borderSubtle,
    borderLeftWidth: 3,
    borderLeftColor: `${PENDING.coral}88`,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.18,
    shadowRadius: 6,
    elevation: 2,
  },
  cardFailed: {
    borderLeftColor: '#B8B8C7',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  avatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: PENDING.bgHighlight,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: PENDING.borderSubtle,
  },
  headerText: {
    flex: 1,
    marginLeft: 10,
  },
  authorName: {
    fontSize: 14,
    fontWeight: '700',
    color: PENDING.textPrimary,
  },
  pendingLabel: {
    fontSize: 11,
    color: PENDING.textMuted,
    marginTop: 2,
  },
  bodyRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  bodyRowNoTile: {
    paddingRight: 0,
  },
  textColumn: {
    flex: 1,
    minWidth: 0,
  },
  answerText: {
    fontSize: 15,
    color: PENDING.textPrimary,
    lineHeight: 22,
  },
  answerTextMuted: {
    fontSize: 14,
    color: PENDING.textSecondary,
    lineHeight: 20,
  },
  statusText: {
    marginTop: 6,
    fontSize: 12,
    fontWeight: '700',
    color: PENDING.coralSoft,
  },
  statusTextFailed: {
    color: PENDING.textSecondary,
  },
  mediaTile: {
    width: 68,
    height: 68,
    borderRadius: 14,
    overflow: 'hidden',
    backgroundColor: PENDING.bgHighlight,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: PENDING.borderSubtle,
  },
  mediaTileFailed: {
    opacity: 0.72,
  },
  mediaScrim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.24)',
  },
  mediaIconChip: {
    position: 'absolute',
    top: 7,
    left: 7,
    width: 24,
    height: 24,
    borderRadius: 8,
    backgroundColor: 'rgba(13, 13, 26, 0.68)',
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
    backgroundColor: 'rgba(0,0,0,0.26)',
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
    paddingHorizontal: 11,
    paddingVertical: 6,
  },
  retryText: {
    fontSize: 12,
    fontWeight: '800',
    color: '#FFF',
  },
  removeBtn: {
    borderRadius: 999,
    paddingHorizontal: 11,
    paddingVertical: 6,
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
