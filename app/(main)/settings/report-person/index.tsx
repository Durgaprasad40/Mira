import React from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '@/lib/constants';

// Phase-1 report flow categories (mirrors Phase-2 UX, Phase-1 data only)
const REPORT_CATEGORIES = [
  {
    key: 'recent_chats',
    title: 'Recent Chats',
    subtitle: 'Report someone from your recent chats (last 30 days)',
    icon: 'chatbubble-outline' as const,
    iconColor: COLORS.primary,
  },
  {
    key: 'past_connections',
    title: 'Past Connections',
    subtitle: 'Report someone from a past connection (coming soon)',
    icon: 'heart-dislike-outline' as const,
    iconColor: COLORS.error,
  },
  {
    key: 'blocked_users',
    title: 'Blocked Users',
    subtitle: 'Report someone you blocked',
    icon: 'ban-outline' as const,
    iconColor: COLORS.textMuted,
  },
] as const;

export type Phase1ReportCategory = (typeof REPORT_CATEGORIES)[number]['key'];

export default function Phase1ReportPersonSelectInteractionScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const handleCategorySelect = (category: Phase1ReportCategory) => {
    router.push({
      pathname: '/(main)/settings/report-person/select-person-list',
      params: { category },
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
            <Ionicons name="shield-checkmark" size={24} color={COLORS.primary} />
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
              <View
                style={[
                  styles.categoryIconBox,
                  { backgroundColor: category.iconColor + '20' },
                ]}
              >
                <Ionicons name={category.icon} size={24} color={category.iconColor} />
              </View>
              <View style={styles.categoryTextContainer}>
                <Text style={styles.categoryTitle}>{category.title}</Text>
                <Text style={styles.categorySubtitle}>{category.subtitle}</Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color={COLORS.textLight} />
            </TouchableOpacity>
          ))}
        </View>

        {/* Help Card */}
        <View style={styles.helpCard}>
          <Ionicons name="help-circle-outline" size={20} color={COLORS.textMuted} />
          <View style={styles.helpTextContainer}>
            <Text style={styles.helpTitle}>Can’t find someone?</Text>
            <Text style={styles.helpText}>
              You can only report users you’ve interacted with. Recent chats show the last 30 days.
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
    paddingTop: 20,
  },
  infoBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: COLORS.backgroundDark,
    borderRadius: 14,
    padding: 16,
    marginBottom: 24,
    gap: 14,
  },
  infoBannerIcon: {
    width: 48,
    height: 48,
    borderRadius: 12,
    backgroundColor: COLORS.primary + '20',
    alignItems: 'center',
    justifyContent: 'center',
  },
  infoBannerTextContainer: {
    flex: 1,
  },
  infoBannerTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.text,
    marginBottom: 4,
  },
  infoBannerText: {
    fontSize: 14,
    color: COLORS.textMuted,
    lineHeight: 20,
  },
  categoriesSection: {
    marginBottom: 24,
  },
  sectionLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 12,
  },
  categoryCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.backgroundDark,
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
    color: COLORS.text,
    marginBottom: 4,
  },
  categorySubtitle: {
    fontSize: 13,
    color: COLORS.textMuted,
    lineHeight: 18,
  },
  helpCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: COLORS.backgroundDark,
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
    color: COLORS.text,
    marginBottom: 4,
  },
  helpText: {
    fontSize: 13,
    color: COLORS.textMuted,
    lineHeight: 18,
  },
});

