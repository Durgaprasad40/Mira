import React, { useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Image,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { COLORS } from '@/lib/constants';
import { useAuthStore } from '@/stores/authStore';
import { isDemoMode } from '@/hooks/useConvex';
import type { Phase1ReportCategory } from './index';

// 30 days in ms
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

type CategoryConfig = {
  title: string;
  emptyTitle: string;
  emptyMessage: string;
  icon: keyof typeof Ionicons.glyphMap;
};

const CATEGORY_CONFIG: Record<Phase1ReportCategory, CategoryConfig> = {
  recent_chats: {
    title: 'Recent Chats',
    emptyTitle: 'No Recent Chats',
    emptyMessage:
      'No chats in the last 30 days. People you message will appear here.',
    icon: 'chatbubble-outline',
  },
  past_connections: {
    title: 'Past Connections',
    emptyTitle: 'No Past Connections',
    emptyMessage:
      'Past connections reporting isn’t available yet on Phase-1.',
    icon: 'heart-dislike-outline',
  },
  blocked_users: {
    title: 'Blocked Users',
    emptyTitle: 'No Blocked Users',
    emptyMessage:
      'You haven’t blocked anyone yet. Users you block will appear here.',
    icon: 'ban-outline',
  },
};

type PersonItem = {
  convexUserId: string;
  name: string;
  photoUrl: string | null;
  contextLabel: string;
  timestamp?: number;
};

export default function Phase1SelectPersonListScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const authUserId = useAuthStore((s) => s.userId);

  const params = useLocalSearchParams<{ category?: string }>();
  const category = (params.category as Phase1ReportCategory) || 'recent_chats';
  const categoryConfig = CATEGORY_CONFIG[category] || CATEGORY_CONFIG.recent_chats;

  // Phase-1 real chats: conversations + messages (NOT matches, NOT Phase-2 privateConversations)
  const recentConversations = useQuery(
    api.messages.getConversations,
    !isDemoMode && category === 'recent_chats' && authUserId
      ? { authUserId, limit: 50 }
      : 'skip'
  );

  const blockedUsersData = useQuery(
    api.users.getMyBlockedUsers,
    !isDemoMode && category === 'blocked_users' && authUserId
      ? { authUserId }
      : 'skip'
  );

  const isLoading =
    !isDemoMode &&
    ((category === 'recent_chats' && authUserId && recentConversations === undefined) ||
      (category === 'blocked_users' && authUserId && blockedUsersData === undefined));

  const thirtyDaysAgo = useMemo(() => Date.now() - THIRTY_DAYS_MS, []);

  const people = useMemo((): PersonItem[] => {
    if (isDemoMode) return [];

    if (category === 'recent_chats') {
      if (!Array.isArray(recentConversations)) return [];

      return recentConversations
        .filter((c: any) => {
          const lastActivity = c?.lastMessage?.createdAt ?? c?.lastMessageAt ?? 0;
          return lastActivity >= thirtyDaysAgo;
        })
        .map((c: any) => {
          const otherUserId = c?.otherUser?.id ? String(c.otherUser.id) : '';
          return {
            convexUserId: otherUserId,
            name: c?.otherUser?.name || 'Anonymous',
            photoUrl: c?.otherUser?.photoUrl ?? null,
            contextLabel: 'Chat',
            timestamp: c?.lastMessage?.createdAt ?? c?.lastMessageAt,
          };
        })
        .filter((p: PersonItem) => Boolean(p.convexUserId));
    }

    if (category === 'blocked_users') {
      const blocked =
        (blockedUsersData as any)?.success === true
          ? (blockedUsersData as any)?.blockedUsers ?? []
          : [];
      if (!Array.isArray(blocked)) return [];
      return blocked.map((b: any) => ({
        convexUserId: String(b.blockedUserId),
        name: b.displayName || 'Unknown',
        photoUrl: null,
        contextLabel: 'Blocked',
        timestamp: b.blockedAt ?? undefined,
      }));
    }

    // past_connections: not available (Phase-1 backend not exposed yet)
    return [];
  }, [blockedUsersData, category, recentConversations, thirtyDaysAgo]);

  const handleSelectPerson = (person: PersonItem) => {
    router.push({
      pathname: '/(main)/settings/report-person/report-form',
      params: {
        reportedConvexUserId: person.convexUserId,
        userName: person.name,
        userPhoto: person.photoUrl || '',
        sourceCategory: category,
      },
    } as any);
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => router.back()}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        >
          <Ionicons name="arrow-back" size={24} color={COLORS.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{categoryConfig.title}</Text>
        <View style={{ width: 24 }} />
      </View>

      {isLoading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={COLORS.primary} />
          <Text style={styles.loadingText}>Loading...</Text>
        </View>
      ) : (
        <ScrollView
          style={styles.content}
          contentContainerStyle={[
            styles.scrollContent,
            { paddingBottom: insets.bottom + 20 },
          ]}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.categoryInfo}>
            <View style={styles.categoryIconBox}>
              <Ionicons name={categoryConfig.icon} size={20} color={COLORS.primary} />
            </View>
            <Text style={styles.categoryInfoText}>
              Select the person you want to report (last 30 days)
            </Text>
          </View>

          {people.length > 0 ? (
            <View style={styles.personList}>
              {people.map((person, index) => (
                <TouchableOpacity
                  key={`${person.convexUserId}:${index}`}
                  style={[
                    styles.personRow,
                    index === people.length - 1 && styles.personRowLast,
                  ]}
                  onPress={() => handleSelectPerson(person)}
                  activeOpacity={0.7}
                >
                  <View style={styles.personInfo}>
                    {person.photoUrl ? (
                      <Image source={{ uri: person.photoUrl }} style={styles.avatar} />
                    ) : (
                      <View style={[styles.avatar, styles.avatarPlaceholder]}>
                        <Ionicons name="person" size={20} color={COLORS.textMuted} />
                      </View>
                    )}
                    <View style={styles.personTextContainer}>
                      <Text style={styles.personName} numberOfLines={1}>
                        {person.name}
                      </Text>
                      <Text style={styles.personContext}>{person.contextLabel}</Text>
                    </View>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color={COLORS.textLight} />
                </TouchableOpacity>
              ))}
            </View>
          ) : (
            <View style={styles.emptyState}>
              <View style={styles.emptyIconBox}>
                <Ionicons name={categoryConfig.icon} size={32} color={COLORS.textMuted} />
              </View>
              <Text style={styles.emptyTitle}>{categoryConfig.emptyTitle}</Text>
              <Text style={styles.emptyText}>{categoryConfig.emptyMessage}</Text>
              <TouchableOpacity
                style={styles.backButton}
                onPress={() => router.back()}
                activeOpacity={0.7}
              >
                <Text style={styles.backButtonText}>Try Another Category</Text>
              </TouchableOpacity>
            </View>
          )}

          {people.length > 0 && (
            <View style={styles.hintCard}>
              <Ionicons
                name="information-circle-outline"
                size={18}
                color={COLORS.textMuted}
              />
              <Text style={styles.hintText}>
                Only showing interactions from the last 30 days.
              </Text>
            </View>
          )}
        </ScrollView>
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
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: COLORS.text,
  },
  content: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingTop: 16,
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  loadingText: {
    fontSize: 14,
    color: COLORS.textMuted,
  },
  categoryInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
    gap: 10,
  },
  categoryIconBox: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: COLORS.primary + '20',
    alignItems: 'center',
    justifyContent: 'center',
  },
  categoryInfoText: {
    fontSize: 14,
    color: COLORS.textMuted,
    flex: 1,
  },
  personList: {
    backgroundColor: COLORS.backgroundDark,
    borderRadius: 14,
    overflow: 'hidden',
    marginBottom: 16,
  },
  personRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 14,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  personRowLast: {
    borderBottomWidth: 0,
  },
  personInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    marginRight: 8,
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: COLORS.backgroundDark,
  },
  avatarPlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.background,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  personTextContainer: {
    flex: 1,
    marginLeft: 12,
  },
  personName: {
    fontSize: 15,
    fontWeight: '600',
    color: COLORS.text,
    marginBottom: 2,
  },
  personContext: {
    fontSize: 13,
    color: COLORS.textMuted,
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: 40,
    paddingHorizontal: 20,
  },
  emptyIconBox: {
    width: 64,
    height: 64,
    borderRadius: 16,
    backgroundColor: COLORS.backgroundDark,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.text,
    marginBottom: 8,
  },
  emptyText: {
    fontSize: 14,
    color: COLORS.textMuted,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 20,
  },
  backButton: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: COLORS.backgroundDark,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  backButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.text,
  },
  hintCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: COLORS.backgroundDark,
    borderRadius: 10,
    padding: 12,
    gap: 8,
  },
  hintText: {
    fontSize: 13,
    color: COLORS.textMuted,
    flex: 1,
    lineHeight: 18,
  },
});

