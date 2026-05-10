import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery } from 'convex/react';

import { api } from '@/convex/_generated/api';
import { COLORS } from '@/lib/constants';
import { safePush } from '@/lib/safeRouter';
import { useAuthStore } from '@/stores/authStore';
import { isDemoMode } from '@/hooks/useConvex';
import { Toast } from '@/components/ui/Toast';

type PendingConfessionConnect = {
  connectId: string;
  confessionId: string;
  status: 'pending';
  createdAt: number;
  updatedAt: number;
  expiresAt: number;
  confessionText: string;
  confessionMood: string;
  confessionCreatedAt: number;
};

function formatTimeLeft(expiresAt: number): string {
  const diff = expiresAt - Date.now();
  if (diff <= 0) return 'Expired';
  const minutes = Math.max(1, Math.ceil(diff / 60000));
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  if (hours > 0) return `${hours}h ${remainingMinutes}m left`;
  return `${minutes}m left`;
}

function getSafeErrorMessage(error: unknown): string {
  return error instanceof Error && error.message
    ? error.message
    : 'Please try again later.';
}

export default function CommentConnectRequestsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const token = useAuthStore((s) => s.token);
  const authReady = useAuthStore((s) => s.authReady);
  const pendingRequests = useQuery(
    api.confessions.listPendingConfessionConnectsForMe,
    !isDemoMode && token ? { token } : 'skip'
  ) as PendingConfessionConnect[] | undefined;
  const respondToConfessionConnect = useMutation(api.confessions.respondToConfessionConnect);
  const [busyConnectId, setBusyConnectId] = useState<string | null>(null);

  const openConnectCelebration = useCallback((conversationId?: string | null, matchId?: string | null) => {
    const normalized = typeof conversationId === 'string' ? conversationId.trim() : '';
    if (!normalized) {
      Toast.show('Connected. Chat is being prepared.');
      return;
    }
    const params = new URLSearchParams({
      conversationId: normalized,
      source: 'confession',
      phase: 'phase1',
    });
    const normalizedMatchId = typeof matchId === 'string' ? matchId.trim() : '';
    if (normalizedMatchId) {
      params.set('matchId', normalizedMatchId);
    }
    safePush(
      router,
      `/(main)/match-celebration?${params.toString()}` as any,
      'connectRequests->connectCelebration'
    );
  }, [router]);

  const handleDecision = useCallback(async (
    connectId: string,
    decision: 'connect' | 'reject'
  ) => {
    if (!token || busyConnectId) return;
    setBusyConnectId(connectId);
    try {
      const result = await respondToConfessionConnect({
        token,
        connectId: connectId as any,
        decision,
      }) as { status?: string; conversationId?: string; matchId?: string };

      if (decision === 'connect') {
        if (result?.conversationId) {
          openConnectCelebration(result.conversationId, result.matchId);
        } else {
          Alert.alert('Connected', 'The chat is being prepared. Please try opening it again.');
        }
      } else {
        Toast.show('Connect request declined.');
      }
    } catch (error) {
      Alert.alert('Connect unavailable', getSafeErrorMessage(error));
    } finally {
      setBusyConnectId(null);
    }
  }, [busyConnectId, openConnectCelebration, respondToConfessionConnect, token]);

  const renderRequest = useCallback(({ item }: { item: PendingConfessionConnect }) => {
    const isBusy = busyConnectId === item.connectId;
    return (
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <View style={styles.cardIcon}>
            <Ionicons name="heart-outline" size={16} color={COLORS.primary} />
          </View>
          <View style={styles.cardHeaderText}>
            <Text style={styles.cardTitle}>Connect request</Text>
            <Text style={styles.cardMeta}>{formatTimeLeft(item.expiresAt)}</Text>
          </View>
        </View>

        <Text style={styles.confessionText} numberOfLines={4}>
          {item.confessionText}
        </Text>

        <Text style={styles.safeHint}>
          If you connect too, Mira opens a real Messages chat. Your identity stays protected until both sides agree.
        </Text>

        <View style={styles.buttonRow}>
          <TouchableOpacity
            style={[styles.connectButton, isBusy && styles.buttonDisabled]}
            onPress={() => void handleDecision(item.connectId, 'connect')}
            disabled={isBusy}
            activeOpacity={0.82}
          >
            {isBusy ? (
              <ActivityIndicator size="small" color={COLORS.white} />
            ) : (
              <>
                <Ionicons name="checkmark" size={16} color={COLORS.white} />
                <Text style={styles.connectButtonText}>Connect</Text>
              </>
            )}
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.rejectButton, isBusy && styles.buttonDisabled]}
            onPress={() => void handleDecision(item.connectId, 'reject')}
            disabled={isBusy}
            activeOpacity={0.82}
          >
            <Ionicons name="close" size={16} color={COLORS.text} />
            <Text style={styles.rejectButtonText}>Reject</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }, [busyConnectId, handleDecision]);

  const isLoading = !isDemoMode && !!token && pendingRequests === undefined;
  const unavailable = !isDemoMode && authReady && !token;

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={() => router.back()} hitSlop={8}>
          <Ionicons name="arrow-back" size={24} color={COLORS.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Connect Requests</Text>
        <View style={{ width: 40 }} />
      </View>

      {isLoading ? (
        <View style={styles.centerState}>
          <ActivityIndicator size="large" color={COLORS.primary} />
          <Text style={styles.stateTitle}>Loading requests...</Text>
        </View>
      ) : unavailable || isDemoMode ? (
        <View style={styles.centerState}>
          <Ionicons name="lock-closed-outline" size={44} color={COLORS.textMuted} />
          <Text style={styles.stateTitle}>Connect requests unavailable</Text>
          <Text style={styles.stateSubtitle}>Please sign in again to manage requests.</Text>
        </View>
      ) : (
        <FlatList
          data={pendingRequests ?? []}
          keyExtractor={(item) => item.connectId}
          renderItem={renderRequest}
          contentContainerStyle={[
            styles.listContent,
            (pendingRequests ?? []).length === 0 && styles.emptyListContent,
          ]}
          ListHeaderComponent={
            (pendingRequests ?? []).length > 0 ? (
              <Text style={styles.screenHint}>
                Review pending Confess connect requests. No profile details are shown until both sides connect.
              </Text>
            ) : null
          }
          ListEmptyComponent={
            <View style={styles.centerState}>
              <Ionicons name="people-outline" size={48} color={COLORS.textMuted} />
              <Text style={styles.stateTitle}>No pending requests</Text>
              <Text style={styles.stateSubtitle}>New Confess connect requests will appear here.</Text>
            </View>
          }
          showsVerticalScrollIndicator={false}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  header: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.border,
  },
  backButton: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: COLORS.text,
  },
  listContent: {
    padding: 16,
    paddingBottom: 32,
  },
  emptyListContent: {
    flexGrow: 1,
  },
  screenHint: {
    marginBottom: 12,
    fontSize: 13,
    lineHeight: 18,
    color: COLORS.textLight,
  },
  card: {
    padding: 16,
    marginBottom: 12,
    borderRadius: 14,
    backgroundColor: COLORS.background,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: COLORS.border,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 10,
  },
  cardIcon: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,107,107,0.10)',
  },
  cardHeaderText: {
    flex: 1,
  },
  cardTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: COLORS.text,
  },
  cardMeta: {
    marginTop: 2,
    fontSize: 12,
    color: COLORS.textMuted,
  },
  confessionText: {
    fontSize: 15,
    lineHeight: 21,
    fontWeight: '500',
    color: COLORS.text,
  },
  safeHint: {
    marginTop: 10,
    fontSize: 12,
    lineHeight: 17,
    color: COLORS.textLight,
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 14,
  },
  connectButton: {
    flex: 1,
    minHeight: 42,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderRadius: 12,
    backgroundColor: COLORS.primary,
  },
  rejectButton: {
    flex: 1,
    minHeight: 42,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderRadius: 12,
    backgroundColor: COLORS.backgroundDark,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: COLORS.border,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  connectButtonText: {
    fontSize: 14,
    fontWeight: '700',
    color: COLORS.white,
  },
  rejectButtonText: {
    fontSize: 14,
    fontWeight: '700',
    color: COLORS.text,
  },
  centerState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 28,
  },
  stateTitle: {
    marginTop: 12,
    fontSize: 17,
    fontWeight: '700',
    color: COLORS.text,
    textAlign: 'center',
  },
  stateSubtitle: {
    marginTop: 8,
    fontSize: 14,
    lineHeight: 20,
    color: COLORS.textLight,
    textAlign: 'center',
  },
});
