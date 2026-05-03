import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { TodAvatar } from '@/components/truthdare/TodAvatar';

const COLORS = {
  surface: '#1C1C36',
  surfaceSoft: '#252545',
  coral: '#E94560',
  coralSoft: '#FF6B8A',
  truth: '#7C6AEF',
  dare: '#FF7849',
  textPrimary: '#F5F5F7',
  textSecondary: '#B8B8C7',
  textMuted: '#6E6E82',
  border: 'rgba(255, 255, 255, 0.08)',
};

export type TodConnectInboxRequest = {
  requestId: string;
  createdAt: number;
  promptId: string;
  answerId: string;
  fromUserId: string;
  senderName?: string | null;
  senderPhotoUrl?: string | null;
  senderPhotoBlurMode?: 'none' | 'blur' | string | null;
  senderIsAnonymous?: boolean | null;
  promptType?: 'truth' | 'dare' | string | null;
  relationship?: {
    state: 'none' | 'connected' | 'blocked';
    conversationId?: string | null;
  } | null;
};

type TodConnectRequestCardProps = {
  request: TodConnectInboxRequest;
  highlighted?: boolean;
  onPress: (request: TodConnectInboxRequest) => void;
  onOpenChat: (conversationId: string) => void;
};

function formatTimeAgo(timestamp: number): string {
  const diffMs = Math.max(0, Date.now() - timestamp);
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) return 'Now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function getFirstName(name: string): string {
  return name.trim().split(/\s+/)[0] || name;
}

export function TodConnectRequestCard({
  request,
  highlighted = false,
  onPress,
  onOpenChat,
}: TodConnectRequestCardProps) {
  const isDare = request.promptType === 'dare';
  const chipColor = isDare ? COLORS.dare : COLORS.truth;
  const displayName = request.senderIsAnonymous ? 'Anonymous' : (request.senderName || 'Someone');
  const conversationId = request.relationship?.conversationId ?? null;
  const isConnected = request.relationship?.state === 'connected' && !!conversationId;

  return (
    <TouchableOpacity
      style={[styles.row, highlighted && styles.rowHighlighted]}
      activeOpacity={0.84}
      onPress={() => (isConnected ? onOpenChat(conversationId) : onPress(request))}
    >
      <TodAvatar
        size={42}
        photoUrl={request.senderPhotoUrl ?? null}
        isAnonymous={!!request.senderIsAnonymous}
        photoBlurMode={request.senderPhotoBlurMode ?? 'none'}
        label={displayName}
        borderWidth={1}
        borderColor={COLORS.border}
        backgroundColor={COLORS.surfaceSoft}
        iconColor={COLORS.textMuted}
      />

      <View style={styles.copy}>
        <View style={styles.nameRow}>
          <Text style={styles.name} numberOfLines={1}>
            {getFirstName(displayName)}
          </Text>
          <Text style={styles.time}>{formatTimeAgo(request.createdAt)}</Text>
        </View>
        <View style={styles.contextRow}>
          <View style={[styles.typeDot, { backgroundColor: chipColor }]} />
          <Text style={styles.contextText} numberOfLines={1}>
            {isConnected
              ? 'Already connected'
              : `wants to connect from a ${isDare ? 'Dare' : 'Truth'}`}
          </Text>
        </View>
      </View>

      {isConnected ? (
        <Text style={styles.openChatText}>Open chat</Text>
      ) : (
        <Ionicons name="chevron-forward" size={18} color={COLORS.textMuted} />
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  row: {
    minHeight: 66,
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 16,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 10,
  },
  rowHighlighted: {
    borderColor: `${COLORS.coral}85`,
    shadowColor: COLORS.coral,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.22,
    shadowRadius: 12,
    elevation: 4,
  },
  copy: {
    flex: 1,
    marginLeft: 11,
    marginRight: 8,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  name: {
    flex: 1,
    color: COLORS.textPrimary,
    fontSize: 14,
    fontWeight: '800',
  },
  time: {
    color: COLORS.textMuted,
    fontSize: 11,
    fontWeight: '700',
  },
  contextRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 4,
  },
  typeDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  contextText: {
    flex: 1,
    color: COLORS.textSecondary,
    fontSize: 12,
    fontWeight: '600',
  },
  openChatText: {
    color: COLORS.coralSoft,
    fontSize: 12,
    fontWeight: '800',
  },
});
