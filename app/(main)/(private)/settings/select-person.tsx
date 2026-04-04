/**
 * Phase-2 Report Person - Category Selection Screen
 *
 * First step in the report flow: select interaction category.
 * Does NOT show user profiles directly - only category cards.
 *
 * Categories (limited to last 30 days):
 * 1. Recent Chats - Report someone from recent private conversations
 * 2. Past Connections - Report someone from ended/disconnected matches
 *
 * Note: Chat room moderation is handled separately through the room's
 * own moderation system, not through this report flow.
 *
 * Uses Phase-2 dark premium styling (INCOGNITO_COLORS).
 */
import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { INCOGNITO_COLORS } from '@/lib/constants';

const C = INCOGNITO_COLORS;

// Report source categories (limited to last 30 days)
const REPORT_CATEGORIES = [
  {
    key: 'recent_chats',
    title: 'Recent Chats',
    subtitle: 'Report someone from your private chats (last 30 days)',
    icon: 'chatbubble-outline' as const,
    iconColor: C.primary,
  },
  {
    key: 'past_connections',
    title: 'Past Connections',
    subtitle: 'Report someone from an ended connection (last 30 days)',
    icon: 'heart-dislike-outline' as const,
    iconColor: '#EF4444',
  },
] as const;

export type ReportCategory = (typeof REPORT_CATEGORIES)[number]['key'];

export default function SelectPersonScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const handleCategorySelect = (category: ReportCategory) => {
    // Navigate to person list screen with the selected category
    router.push({
      pathname: '/(main)/(private)/settings/select-person-list',
      params: { category },
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
        <Text style={styles.headerTitle}>Report a Person</Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView
        style={styles.content}
        contentContainerStyle={[
          styles.scrollContent,
          { paddingBottom: insets.bottom + 20 },
        ]}
        showsVerticalScrollIndicator={false}
      >
        {/* Info Banner */}
        <View style={styles.infoBanner}>
          <View style={styles.infoBannerIcon}>
            <Ionicons name="shield-checkmark" size={24} color={C.primary} />
          </View>
          <View style={styles.infoBannerTextContainer}>
            <Text style={styles.infoBannerTitle}>Your Safety Matters</Text>
            <Text style={styles.infoBannerText}>
              Select where you interacted with the person you want to report.
            </Text>
          </View>
        </View>

        {/* Category Cards */}
        <View style={styles.categoriesSection}>
          <Text style={styles.sectionLabel}>Choose Interaction Type</Text>

          {REPORT_CATEGORIES.map((category) => (
            <TouchableOpacity
              key={category.key}
              style={styles.categoryCard}
              onPress={() => handleCategorySelect(category.key)}
              activeOpacity={0.7}
            >
              <View style={[styles.categoryIconBox, { backgroundColor: category.iconColor + '20' }]}>
                <Ionicons name={category.icon} size={24} color={category.iconColor} />
              </View>
              <View style={styles.categoryTextContainer}>
                <Text style={styles.categoryTitle}>{category.title}</Text>
                <Text style={styles.categorySubtitle}>{category.subtitle}</Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color={C.textLight} />
            </TouchableOpacity>
          ))}
        </View>

        {/* Help Card */}
        <View style={styles.helpCard}>
          <Ionicons name="help-circle-outline" size={20} color={C.textLight} />
          <View style={styles.helpTextContainer}>
            <Text style={styles.helpTitle}>Can't find the right category?</Text>
            <Text style={styles.helpText}>
              You can only report users you've interacted with. If you haven't chatted or connected with someone, they won't appear in your list.
            </Text>
          </View>
        </View>
      </ScrollView>
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
    paddingTop: 20,
  },
  // Info banner
  infoBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: C.surface,
    borderRadius: 14,
    padding: 16,
    marginBottom: 24,
    gap: 14,
  },
  infoBannerIcon: {
    width: 48,
    height: 48,
    borderRadius: 12,
    backgroundColor: C.primary + '20',
    alignItems: 'center',
    justifyContent: 'center',
  },
  infoBannerTextContainer: {
    flex: 1,
  },
  infoBannerTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: C.text,
    marginBottom: 4,
  },
  infoBannerText: {
    fontSize: 14,
    color: C.textLight,
    lineHeight: 20,
  },
  // Categories section
  categoriesSection: {
    marginBottom: 24,
  },
  sectionLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: C.textLight,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 12,
  },
  categoryCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: C.surface,
    borderRadius: 14,
    padding: 16,
    marginBottom: 10,
  },
  categoryIconBox: {
    width: 48,
    height: 48,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 14,
  },
  categoryTextContainer: {
    flex: 1,
    marginRight: 8,
  },
  categoryTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: C.text,
    marginBottom: 4,
  },
  categorySubtitle: {
    fontSize: 13,
    color: C.textLight,
    lineHeight: 18,
  },
  // Help card
  helpCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: C.surface,
    borderRadius: 12,
    padding: 14,
    gap: 10,
  },
  helpTextContainer: {
    flex: 1,
  },
  helpTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: C.text,
    marginBottom: 4,
  },
  helpText: {
    fontSize: 13,
    color: C.textLight,
    lineHeight: 18,
  },
});
