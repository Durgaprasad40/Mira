import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { COLORS, SPACING, SIZES, FONT_SIZE, FONT_WEIGHT, HAIRLINE, moderateScale } from '@/lib/constants';
import { Toast } from '@/components/ui/Toast';
import { useAuthStore } from '@/stores/authStore';
import { isDemoMode } from '@/hooks/useConvex';
import { asCommentConnectId } from '@/convex/id';

// Helper for time ago
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

// Mood config for display
const MOOD_CONFIG: Record<string, { emoji: string; color: string; bg: string }> = {
  romantic: { emoji: '❤️', color: '#E91E63', bg: 'rgba(233,30,99,0.12)' },
  spicy: { emoji: '🔥', color: '#FF5722', bg: 'rgba(255,87,34,0.12)' },
  emotional: { emoji: '😢', color: '#2196F3', bg: 'rgba(33,150,243,0.12)' },
  funny: { emoji: '😂', color: '#FF9800', bg: 'rgba(255,152,0,0.12)' },
};

interface PendingConnect {
  connectId: string;
  confessionId: string;
  replyId: string;
  confessionText: string;
  confessionMood: string;
  replyText: string;
  requestedAt: number;
}

export default function CommentConnectRequestsScreen() {
  const router = useRouter();
  const userId = useAuthStore((s) => s.userId);
  const currentUserId = isDemoMode ? (userId || 'demo_user_1') : (userId || undefined);

  // State for tracking which request is being responded to
  const [respondingId, setRespondingId] = useState<string | null>(null);
  const [respondingAction, setRespondingAction] = useState<'accept' | 'reject' | null>(null);

  // Query pending connect requests
  const pendingConnects = useQuery(
    api.confessions.getPendingCommentConnects,
    !isDemoMode && currentUserId ? { userId: currentUserId } : 'skip'
  );

  // Mutation to respond
  const respondMutation = useMutation(api.confessions.respondToCommentConnect);

  const handleRespond = useCallback(async (connectId: string, action: 'accept' | 'reject') => {
    if (!currentUserId || respondingId) return;

    const connectRowId = asCommentConnectId(connectId);
    if (!connectRowId) {
      Toast.show('Invalid request. Please try again.');
      return;
    }

    try {
      setRespondingId(connectId);
      setRespondingAction(action);

      const result = await respondMutation({
        connectId: connectRowId,
        userId: currentUserId,
        action,
      });

      if (action === 'accept' && result.matchCreated) {
        Toast.show("It's a match! You can now chat.");
        // FIX 1: Navigate to match celebration with matchId, userId, and source
        // source=confessions tells match-celebration to navigate to Confessions tab on "Keep Discovering"
        if (result.matchId && result.otherUserId) {
          router.replace(`/(main)/match-celebration?matchId=${result.matchId}&userId=${result.otherUserId}&source=confessions` as any);
        } else if (result.matchId) {
          router.replace(`/(main)/match-celebration?matchId=${result.matchId}&source=confessions` as any);
        }
      } else if (action === 'reject') {
        Toast.show('Request declined');
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Failed to respond. Please try again.';
      Toast.show(message);
    } finally {
      setRespondingId(null);
      setRespondingAction(null);
    }
  }, [currentUserId, respondingId, respondMutation, router]);

  const handleAccept = useCallback((connectId: string) => {
    Alert.alert(
      'Accept Connection?',
      'Accepting will create a match and you can start chatting.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Accept', onPress: () => handleRespond(connectId, 'accept') },
      ]
    );
  }, [handleRespond]);

  const handleReject = useCallback((connectId: string) => {
    Alert.alert(
      'Decline Request?',
      'Are you sure you want to decline this connection request?',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Decline', style: 'destructive', onPress: () => handleRespond(connectId, 'reject') },
      ]
    );
  }, [handleRespond]);

  const handleOpenConfession = useCallback((confessionId: string) => {
    router.push(`/(main)/confession-thread?confessionId=${confessionId}` as any);
  }, [router]);

  const renderItem = ({ item }: { item: PendingConnect }) => {
    const moodInfo = MOOD_CONFIG[item.confessionMood] || MOOD_CONFIG.romantic;
    const isResponding = respondingId === item.connectId;

    return (
      <View style={styles.requestCard}>
        {/* Confession preview */}
        <TouchableOpacity
          style={styles.confessionPreview}
          onPress={() => handleOpenConfession(item.confessionId)}
          activeOpacity={0.7}
        >
          <View style={styles.confessionHeader}>
            <View style={[styles.moodBadge, { backgroundColor: moodInfo.bg }]}>
              <Text style={styles.moodEmoji}>{moodInfo.emoji}</Text>
            </View>
            <Text style={styles.confessionLabel}>Original Confession</Text>
            <Text style={styles.timeAgo}>{getTimeAgo(item.requestedAt)}</Text>
          </View>
          <Text style={styles.confessionText} numberOfLines={2}>
            {item.confessionText}
          </Text>
        </TouchableOpacity>

        {/* Your reply */}
        <View style={styles.replySection}>
          <View style={styles.replyHeader}>
            <View style={styles.replyAvatar}>
              <Ionicons name="person" size={10} color={COLORS.primary} />
            </View>
            <Text style={styles.replyLabel}>Your reply</Text>
          </View>
          <Text style={styles.replyText} numberOfLines={3}>
            {item.replyText}
          </Text>
        </View>

        {/* Action message */}
        <View style={styles.actionMessage}>
          <Ionicons name="heart" size={14} color={COLORS.primary} />
          <Text style={styles.actionMessageText}>
            The confession author wants to connect with you
          </Text>
        </View>

        {/* Action buttons */}
        <View style={styles.actionButtons}>
          <TouchableOpacity
            style={[styles.rejectButton, isResponding && respondingAction === 'reject' && styles.buttonLoading]}
            onPress={() => handleReject(item.connectId)}
            disabled={isResponding}
          >
            {isResponding && respondingAction === 'reject' ? (
              <ActivityIndicator size="small" color={COLORS.textMuted} />
            ) : (
              <>
                <Ionicons name="close" size={18} color={COLORS.textMuted} />
                <Text style={styles.rejectButtonText}>Decline</Text>
              </>
            )}
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.acceptButton, isResponding && respondingAction === 'accept' && styles.buttonLoading]}
            onPress={() => handleAccept(item.connectId)}
            disabled={isResponding}
          >
            {isResponding && respondingAction === 'accept' ? (
              <ActivityIndicator size="small" color={COLORS.white} />
            ) : (
              <>
                <Ionicons name="heart" size={18} color={COLORS.white} />
                <Text style={styles.acceptButtonText}>Accept</Text>
              </>
            )}
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  const renderEmpty = () => (
    <View style={styles.emptyContainer}>
      <Text style={styles.emptyEmoji}>💬</Text>
      <Text style={styles.emptyTitle}>No connection requests</Text>
      <Text style={styles.emptySubtitle}>
        When confession authors want to connect with you based on your reply, their requests will appear here.
      </Text>
    </View>
  );

  // Loading state
  if (pendingConnects === undefined && !isDemoMode) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.navBar}>
          <TouchableOpacity onPress={() => router.back()} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
            <Ionicons name="arrow-back" size={24} color={COLORS.text} />
          </TouchableOpacity>
          <Text style={styles.navTitle}>Connect Requests</Text>
          <View style={{ width: 24 }} />
        </View>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={COLORS.primary} />
        </View>
      </SafeAreaView>
    );
  }

  const data = pendingConnects || [];

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Navigation Bar */}
      <View style={styles.navBar}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
          <Ionicons name="arrow-back" size={24} color={COLORS.text} />
        </TouchableOpacity>
        <Text style={styles.navTitle}>Connect Requests</Text>
        <View style={{ width: 24 }} />
      </View>

      {/* Info banner */}
      <View style={styles.infoBanner}>
        <Ionicons name="information-circle-outline" size={18} color={COLORS.primary} />
        <Text style={styles.infoBannerText}>
          Authors liked your reply and want to connect. Accept to start chatting!
        </Text>
      </View>

      {/* List */}
      <FlatList
        data={data}
        keyExtractor={(item) => item.connectId}
        renderItem={renderItem}
        ListEmptyComponent={renderEmpty}
        contentContainerStyle={[styles.listContent, data.length === 0 && styles.listContentEmpty]}
        showsVerticalScrollIndicator={false}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.white,
  },
  navBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: SPACING.base,
    paddingVertical: SPACING.md,
    backgroundColor: COLORS.white,
    borderBottomWidth: HAIRLINE,
    borderBottomColor: COLORS.border,
  },
  navTitle: {
    fontSize: FONT_SIZE.lg,
    fontWeight: FONT_WEIGHT.bold,
    color: COLORS.text,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  infoBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    paddingHorizontal: SPACING.base,
    paddingVertical: SPACING.md,
    backgroundColor: 'rgba(255,107,107,0.08)',
  },
  infoBannerText: {
    flex: 1,
    fontSize: FONT_SIZE.caption,
    color: COLORS.text,
    lineHeight: moderateScale(18, 0.4),
  },
  listContent: {
    padding: SPACING.base,
    paddingBottom: SPACING.xl,
  },
  listContentEmpty: {
    flex: 1,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: SPACING.xl,
  },
  emptyEmoji: {
    fontSize: moderateScale(48, 0.3),
    marginBottom: SPACING.base,
  },
  emptyTitle: {
    fontSize: FONT_SIZE.xl,
    fontWeight: FONT_WEIGHT.bold,
    color: COLORS.text,
    marginBottom: SPACING.sm,
    textAlign: 'center',
  },
  emptySubtitle: {
    fontSize: FONT_SIZE.md,
    color: COLORS.textLight,
    textAlign: 'center',
    lineHeight: moderateScale(22, 0.4),
  },
  requestCard: {
    backgroundColor: COLORS.white,
    borderRadius: SIZES.radius.md,
    padding: SPACING.md,
    marginBottom: SPACING.md,
    borderWidth: HAIRLINE,
    borderColor: COLORS.border,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  confessionPreview: {
    marginBottom: SPACING.md,
  },
  confessionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    marginBottom: SPACING.sm,
  },
  moodBadge: {
    paddingHorizontal: SPACING.xs,
    paddingVertical: SPACING.xxs,
    borderRadius: SIZES.radius.xs,
  },
  moodEmoji: {
    fontSize: FONT_SIZE.sm,
  },
  confessionLabel: {
    fontSize: FONT_SIZE.caption,
    fontWeight: FONT_WEIGHT.semibold,
    color: COLORS.text,
  },
  timeAgo: {
    fontSize: FONT_SIZE.xs,
    color: COLORS.textMuted,
    marginLeft: 'auto',
  },
  confessionText: {
    fontSize: FONT_SIZE.md,
    color: COLORS.text,
    lineHeight: moderateScale(20, 0.4),
  },
  replySection: {
    backgroundColor: 'rgba(255,107,107,0.06)',
    borderRadius: SIZES.radius.sm,
    padding: SPACING.sm,
    marginBottom: SPACING.md,
  },
  replyHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.xs,
    marginBottom: SPACING.xs,
  },
  replyAvatar: {
    width: moderateScale(18, 0.3),
    height: moderateScale(18, 0.3),
    borderRadius: moderateScale(9, 0.3),
    backgroundColor: 'rgba(255,107,107,0.2)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  replyLabel: {
    fontSize: FONT_SIZE.xs,
    fontWeight: FONT_WEIGHT.semibold,
    color: COLORS.primary,
  },
  replyText: {
    fontSize: FONT_SIZE.caption,
    color: COLORS.text,
    lineHeight: moderateScale(18, 0.4),
  },
  actionMessage: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.xs,
    marginBottom: SPACING.md,
    paddingVertical: SPACING.xs,
  },
  actionMessageText: {
    fontSize: FONT_SIZE.caption,
    color: COLORS.text,
    fontWeight: FONT_WEIGHT.medium,
  },
  actionButtons: {
    flexDirection: 'row',
    gap: SPACING.sm,
  },
  rejectButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACING.xs,
    paddingVertical: SPACING.md,
    borderRadius: SIZES.radius.xl,
    backgroundColor: COLORS.backgroundDark,
    borderWidth: HAIRLINE,
    borderColor: COLORS.border,
  },
  rejectButtonText: {
    fontSize: FONT_SIZE.md,
    fontWeight: FONT_WEIGHT.semibold,
    color: COLORS.textMuted,
  },
  acceptButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACING.xs,
    paddingVertical: SPACING.md,
    borderRadius: SIZES.radius.xl,
    backgroundColor: COLORS.primary,
  },
  acceptButtonText: {
    fontSize: FONT_SIZE.md,
    fontWeight: FONT_WEIGHT.semibold,
    color: COLORS.white,
  },
  buttonLoading: {
    opacity: 0.7,
  },
});
