/**
 * Phase-2 Report Person - Person List Screen
 *
 * Shows list of people for the selected category (limited to last 30 days).
 * Displays minimal user info: avatar, nickname, context label.
 *
 * Categories:
 * - recent_chats: Users from private conversations (last 30 days)
 * - past_connections: Users from ended/disconnected matches (last 30 days)
 *
 * Note: Chat room moderation is handled separately through the room's
 * own moderation system, not through this report flow.
 *
 * Uses Phase-2 dark premium styling (INCOGNITO_COLORS).
 */
import React, { useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Image,
  ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { INCOGNITO_COLORS } from '@/lib/constants';
import { useAuthStore } from '@/stores/authStore';
import type { ReportCategory } from './select-person';

const C = INCOGNITO_COLORS;

// 30 days in milliseconds
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

// Category display config with detailed empty states
const CATEGORY_CONFIG: Record<ReportCategory, {
  title: string;
  emptyTitle: string;
  emptyMessage: string;
  icon: keyof typeof Ionicons.glyphMap;
}> = {
  recent_chats: {
    title: 'Recent Chats',
    emptyTitle: 'No Recent Chats',
    emptyMessage: 'No private conversations in the last 30 days. People you chat with will appear here.',
    icon: 'chatbubble-outline',
  },
  past_connections: {
    title: 'Past Connections',
    emptyTitle: 'No Past Connections',
    emptyMessage: 'No ended connections in the last 30 days. If you unmatch someone, they\'ll appear here.',
    icon: 'heart-dislike-outline',
  },
};

interface PersonItem {
  id: string;
  name: string;
  photoUrl: string | null;
  contextLabel: string;
  timestamp?: number;
}

export default function SelectPersonListScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const userId = useAuthStore((s) => s.userId);

  // Get category from route params
  const params = useLocalSearchParams<{ category?: string }>();
  const category = (params.category as ReportCategory) || 'recent_chats';
  const categoryConfig = CATEGORY_CONFIG[category] || CATEGORY_CONFIG.recent_chats;

  // Calculate 30-day cutoff
  const thirtyDaysAgo = useMemo(() => Date.now() - THIRTY_DAYS_MS, []);

  // Fetch data based on category
  // Recent Chats: Use getUserPrivateConversations (active conversations)
  const recentConversations = useQuery(
    api.privateConversations.getUserPrivateConversations,
    category === 'recent_chats' && userId ? { authUserId: userId } : 'skip'
  );

  // Past Connections: For now, show empty state
  // Backend would need to query privateConversationParticipants with isHidden=true
  // or look for inactive privateMatches within the last 30 days

  const isLoading = category === 'recent_chats' && recentConversations === undefined;

  // Transform data into person items based on category, filtered to last 30 days
  const people = useMemo((): PersonItem[] => {
    if (category === 'recent_chats') {
      if (!recentConversations) return [];

      // Filter to only conversations with activity in last 30 days
      return recentConversations
        .filter((conv) => {
          const lastActivity = conv.lastMessageAt || conv.createdAt || 0;
          return lastActivity >= thirtyDaysAgo;
        })
        .map((conv) => ({
          id: conv.participantId,
          name: conv.participantName || 'Anonymous',
          photoUrl: conv.participantPhotoUrl,
          contextLabel: 'Private Chat',
          timestamp: conv.lastMessageAt || conv.createdAt,
        }));
    }

    if (category === 'past_connections') {
      // Placeholder - would need backend query for ended connections
      // This would query privateConversationParticipants where isHidden=true
      // and the hiddenAt timestamp is within the last 30 days
      return [];
    }

    return [];
  }, [category, recentConversations, thirtyDaysAgo]);

  const handleSelectPerson = (person: PersonItem) => {
    // Navigate to report form with selected user info
    router.push({
      pathname: '/(main)/(private)/settings/report-person',
      params: {
        userId: person.id,
        userName: person.name,
        userPhoto: person.photoUrl || '',
      },
    } as any);
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => router.back()}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        >
          <Ionicons name="arrow-back" size={24} color={C.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{categoryConfig.title}</Text>
        <View style={{ width: 24 }} />
      </View>

      {isLoading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={C.primary} />
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
          {/* Category Info */}
          <View style={styles.categoryInfo}>
            <View style={styles.categoryIconBox}>
              <Ionicons name={categoryConfig.icon} size={20} color={C.primary} />
            </View>
            <Text style={styles.categoryInfoText}>
              Select the person you want to report (last 30 days)
            </Text>
          </View>

          {/* Person List */}
          {people.length > 0 ? (
            <View style={styles.personList}>
              {people.map((person, index) => (
                <TouchableOpacity
                  key={person.id}
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
                        <Ionicons name="person" size={20} color={C.textLight} />
                      </View>
                    )}
                    <View style={styles.personTextContainer}>
                      <Text style={styles.personName} numberOfLines={1}>
                        {person.name}
                      </Text>
                      <Text style={styles.personContext}>{person.contextLabel}</Text>
                    </View>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color={C.textLight} />
                </TouchableOpacity>
              ))}
            </View>
          ) : (
            <View style={styles.emptyState}>
              <View style={styles.emptyIconBox}>
                <Ionicons name={categoryConfig.icon} size={32} color={C.textLight} />
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

          {/* Help hint */}
          {people.length > 0 && (
            <View style={styles.hintCard}>
              <Ionicons name="information-circle-outline" size={18} color={C.textLight} />
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
    backgroundColor: C.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: C.surface,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: C.text,
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
    color: C.textLight,
  },
  // Category info
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
    backgroundColor: C.primary + '20',
    alignItems: 'center',
    justifyContent: 'center',
  },
  categoryInfoText: {
    fontSize: 14,
    color: C.textLight,
    flex: 1,
  },
  // Person list
  personList: {
    backgroundColor: C.surface,
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
    borderBottomColor: C.border,
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
    backgroundColor: C.accent,
  },
  avatarPlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  personTextContainer: {
    flex: 1,
    marginLeft: 12,
  },
  personName: {
    fontSize: 15,
    fontWeight: '600',
    color: C.text,
    marginBottom: 2,
  },
  personContext: {
    fontSize: 13,
    color: C.textLight,
  },
  // Empty state
  emptyState: {
    alignItems: 'center',
    paddingVertical: 40,
    paddingHorizontal: 20,
  },
  emptyIconBox: {
    width: 64,
    height: 64,
    borderRadius: 16,
    backgroundColor: C.surface,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: C.text,
    marginBottom: 8,
  },
  emptyText: {
    fontSize: 14,
    color: C.textLight,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 20,
  },
  backButton: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.border,
  },
  backButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: C.text,
  },
  // Hint card
  hintCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: C.surface,
    borderRadius: 10,
    padding: 12,
    gap: 8,
  },
  hintText: {
    fontSize: 13,
    color: C.textLight,
    flex: 1,
    lineHeight: 18,
  },
});
