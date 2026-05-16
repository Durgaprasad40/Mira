import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  Alert,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useQuery, useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { useAuthStore } from '@/stores/authStore';
import { COLORS, FONT_SIZE, SPACING, SIZES, lineHeight, moderateScale } from '@/lib/constants';
import { Button } from '@/components/ui';
import { Ionicons } from '@expo/vector-icons';
import { isDemoMode } from '@/hooks/useConvex';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const TEXT_MAX_SCALE = 1.2;
const HEADER_ICON_SIZE = SIZES.icon.lg;
const EMPTY_ICON_SIZE = moderateScale(60, 0.25);
const CARD_ICON_SIZE = SIZES.icon.lg;

export default function DaresScreen() {
  const router = useRouter();
  const userId = useAuthStore((s) => s.userId);
  const token = useAuthStore((s) => s.token);
  const insets = useSafeAreaInsets();

  // TOD-AUTH-1 FIX: token-bound queries. Backend resolves caller from token;
  // authUserId is only sent as a defense-in-depth hint.
  const pendingDares = useQuery(
    api.dares.getPendingDares,
    !isDemoMode && userId && token ? { token, authUserId: userId } : 'skip'
  );

  const daresSent = useQuery(
    api.dares.getDaresSent,
    !isDemoMode && userId && token ? { token, authUserId: userId } : 'skip'
  );

  const acceptDare = useMutation(api.dares.acceptDare);
  const declineDare = useMutation(api.dares.declineDare);

  const handleAccept = async (dareId: string) => {
    if (!userId) return;
    if (!token) {
      Alert.alert('Error', 'Please sign in again to accept this dare.');
      return;
    }

    Alert.alert(
      'Accept Dare?',
      'Accepting this dare will reveal both identities and create a match!',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Accept',
          onPress: async () => {
            try {
              // TOD-AUTH-1 FIX: token-bound mutation.
              const result = await acceptDare({
                token,
                dareId: dareId as any,
                authUserId: userId,
              });
              Alert.alert(
                '🎉 It\'s a Match!',
                `You matched with ${result.fromUser.name}!`,
                [
                  {
                    text: 'Start Chatting',
                    onPress: () => router.push('/(main)/(tabs)/messages'),
                  },
                ]
              );
            } catch (error: any) {
              Alert.alert('Error', error.message || 'Failed to accept dare');
            }
          },
        },
      ]
    );
  };

  const handleDecline = async (dareId: string) => {
    if (!userId) return;
    if (!token) {
      Alert.alert('Error', 'Please sign in again to decline this dare.');
      return;
    }

    Alert.alert('Decline Dare?', 'Are you sure you want to decline this dare?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Decline',
        style: 'destructive',
        onPress: async () => {
          try {
            // TOD-AUTH-1 FIX: token-bound mutation.
            await declineDare({
              token,
              dareId: dareId as any,
              authUserId: userId,
            });
          } catch (error: any) {
            Alert.alert('Error', error.message || 'Failed to decline dare');
          }
        },
      },
    ]);
  };

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + SPACING.base }]}>
        <TouchableOpacity onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={HEADER_ICON_SIZE} color={COLORS.text} />
        </TouchableOpacity>
        <Text maxFontSizeMultiplier={TEXT_MAX_SCALE} style={styles.headerTitle}>
          Truth or Dare
        </Text>
        <View style={{ width: HEADER_ICON_SIZE }} />
      </View>

      <View style={styles.tabs}>
        <Text maxFontSizeMultiplier={TEXT_MAX_SCALE} style={styles.tabTitle}>
          Pending Dares
        </Text>
      </View>

      <FlatList
        data={pendingDares || []}
        keyExtractor={(item) => item.id}
        contentContainerStyle={[styles.listContent, { paddingBottom: Math.max(insets.bottom, SPACING.base) + SPACING.base }]}
        renderItem={({ item }) => (
          <View style={styles.dareCard}>
            <View style={styles.dareHeader}>
              <Ionicons name="dice" size={CARD_ICON_SIZE} color={COLORS.secondary} />
              <Text maxFontSizeMultiplier={TEXT_MAX_SCALE} style={styles.dareTitle}>
                Anonymous Dare
              </Text>
            </View>
            <Text maxFontSizeMultiplier={TEXT_MAX_SCALE} style={styles.dareContent}>
              {item.content}
            </Text>
            <View style={styles.dareActions}>
              <Button
                title="Decline"
                variant="outline"
                onPress={() => handleDecline(item.id)}
                style={styles.declineButton}
              />
              <Button
                title="Accept & Match"
                variant="primary"
                onPress={() => handleAccept(item.id)}
                style={styles.acceptButton}
              />
            </View>
          </View>
        )}
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Ionicons name="dice-outline" size={EMPTY_ICON_SIZE} color={COLORS.textLight} />
            <Text maxFontSizeMultiplier={TEXT_MAX_SCALE} style={styles.emptyTitle}>
              No pending dares
            </Text>
            <Text maxFontSizeMultiplier={TEXT_MAX_SCALE} style={styles.emptySubtitle}>
              Dares you receive will appear here
            </Text>
          </View>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: SPACING.base,
    paddingBottom: SPACING.base,
    backgroundColor: COLORS.background,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  headerTitle: {
    fontSize: FONT_SIZE.xxl,
    fontWeight: '600',
    lineHeight: lineHeight(FONT_SIZE.xxl, 1.2),
    color: COLORS.text,
  },
  tabs: {
    paddingHorizontal: SPACING.base,
    paddingVertical: SPACING.base,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  tabTitle: {
    fontSize: FONT_SIZE.xl,
    fontWeight: '600',
    lineHeight: lineHeight(FONT_SIZE.xl, 1.2),
    color: COLORS.text,
  },
  listContent: {
    paddingTop: SPACING.xs,
  },
  dareCard: {
    backgroundColor: COLORS.backgroundDark,
    marginHorizontal: SPACING.base,
    marginTop: SPACING.base,
    padding: SPACING.lg,
    borderRadius: SIZES.radius.lg,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  dareHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: SPACING.md,
  },
  dareTitle: {
    fontSize: FONT_SIZE.xl,
    fontWeight: '600',
    lineHeight: lineHeight(FONT_SIZE.xl, 1.2),
    color: COLORS.text,
    marginLeft: SPACING.md,
  },
  dareContent: {
    fontSize: FONT_SIZE.lg,
    color: COLORS.text,
    lineHeight: lineHeight(FONT_SIZE.lg, 1.35),
    marginBottom: SPACING.lg,
  },
  dareActions: {
    flexDirection: 'row',
    gap: SPACING.md,
  },
  declineButton: {
    flex: 1,
  },
  acceptButton: {
    flex: 1,
  },
  emptyContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: SPACING.xxl,
    paddingVertical: SPACING.xxxl,
  },
  emptyTitle: {
    fontSize: FONT_SIZE.xxl,
    fontWeight: '600',
    lineHeight: lineHeight(FONT_SIZE.xxl, 1.2),
    color: COLORS.text,
    marginTop: SPACING.base,
    marginBottom: SPACING.sm,
  },
  emptySubtitle: {
    fontSize: FONT_SIZE.body,
    color: COLORS.textLight,
    textAlign: 'center',
    lineHeight: lineHeight(FONT_SIZE.body, 1.35),
  },
});
