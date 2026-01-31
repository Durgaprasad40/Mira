import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Platform,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '@/lib/constants';

interface SafetyTip {
  icon: string;
  title: string;
  description: string;
}

const SAFETY_TIPS: SafetyTip[] = [
  {
    icon: 'flag',
    title: 'Report a User',
    description:
      'Tap the ... menu on any profile or the flag icon in a chat to report inappropriate behavior. Reports are reviewed by our moderation team.',
  },
  {
    icon: 'hand-left',
    title: 'Block a User',
    description:
      'Blocking a user prevents them from seeing your profile, messaging you, or interacting with you. Tap Block in the ... menu on any profile.',
  },
  {
    icon: 'eye-off',
    title: 'Hide Your Profile',
    description:
      'Use Hide from Discovery in Settings to browse without appearing in others\' feeds. Your existing matches are not affected.',
  },
  {
    icon: 'lock-closed',
    title: 'Meeting Safety',
    description:
      'When meeting someone in person: choose a public place, tell a friend where you are going, and trust your instincts. Never share financial information.',
  },
  {
    icon: 'shield-checkmark',
    title: 'Verified Profiles',
    description:
      'Look for the verified badge. Verified users have completed face verification. You can filter for verified-only profiles in Explore.',
  },
  {
    icon: 'chatbubble-ellipses',
    title: 'Messaging Safety',
    description:
      'Messages are filtered for explicit content, solicitation, and underage signals. Flagged content is automatically reviewed.',
  },
];

const REPORT_REASONS = [
  { label: 'Fake profile or catfishing', icon: 'person-remove' },
  { label: 'Inappropriate or explicit photos', icon: 'image' },
  { label: 'Harassment or bullying', icon: 'megaphone' },
  { label: 'Spam or scams', icon: 'mail-unread' },
  { label: 'Underage user', icon: 'alert-circle' },
  { label: 'Solicitation or paid services', icon: 'cash' },
  { label: 'Non-consensual content', icon: 'close-circle' },
  { label: 'Other concerns', icon: 'ellipsis-horizontal-circle' },
];

export default function SafetyReportingScreen() {
  const router = useRouter();

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={24} color={COLORS.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Safety & Reporting</Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={styles.sectionTitle}>Your Safety Matters</Text>
        <Text style={styles.intro}>
          Mira is committed to providing a safe environment. Here is how we protect you
          and how you can help keep the community safe.
        </Text>

        {SAFETY_TIPS.map((tip) => (
          <View key={tip.title} style={styles.tipCard}>
            <View style={styles.tipIconWrap}>
              <Ionicons name={tip.icon as any} size={24} color={COLORS.primary} />
            </View>
            <View style={styles.tipContent}>
              <Text style={styles.tipTitle}>{tip.title}</Text>
              <Text style={styles.tipDescription}>{tip.description}</Text>
            </View>
          </View>
        ))}

        <View style={styles.divider} />

        <Text style={styles.sectionTitle}>What You Can Report</Text>
        <Text style={styles.intro}>
          If you encounter any of the following, please report it immediately:
        </Text>

        <View style={styles.reasonsGrid}>
          {REPORT_REASONS.map((reason) => (
            <View key={reason.label} style={styles.reasonItem}>
              <Ionicons name={reason.icon as any} size={18} color={COLORS.primary} />
              <Text style={styles.reasonText}>{reason.label}</Text>
            </View>
          ))}
        </View>

        <View style={styles.divider} />

        <Text style={styles.sectionTitle}>How Reports Are Handled</Text>
        <View style={styles.processSteps}>
          <View style={styles.stepRow}>
            <View style={styles.stepNumber}><Text style={styles.stepNumberText}>1</Text></View>
            <Text style={styles.stepText}>You submit a report via the Report button</Text>
          </View>
          <View style={styles.stepRow}>
            <View style={styles.stepNumber}><Text style={styles.stepNumberText}>2</Text></View>
            <Text style={styles.stepText}>Our moderation team reviews the report</Text>
          </View>
          <View style={styles.stepRow}>
            <View style={styles.stepNumber}><Text style={styles.stepNumberText}>3</Text></View>
            <Text style={styles.stepText}>Action is taken based on severity (warning, restriction, or ban)</Text>
          </View>
          <View style={styles.stepRow}>
            <View style={styles.stepNumber}><Text style={styles.stepNumberText}>4</Text></View>
            <Text style={styles.stepText}>Critical violations (underage, non-consensual) result in immediate account removal</Text>
          </View>
        </View>

        <View style={styles.emergencyBox}>
          <Ionicons name="call" size={20} color={COLORS.error} />
          <View style={styles.emergencyContent}>
            <Text style={styles.emergencyTitle}>In an Emergency</Text>
            <Text style={styles.emergencyText}>
              If you are in immediate danger, contact local emergency services.
              Mira will cooperate with law enforcement when required.
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
    padding: 16,
    paddingTop: Platform.OS === 'ios' ? 50 : 16,
    backgroundColor: COLORS.background,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: COLORS.text,
  },
  content: {
    padding: 20,
    paddingBottom: 40,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: COLORS.text,
    marginBottom: 8,
  },
  intro: {
    fontSize: 14,
    color: COLORS.textLight,
    lineHeight: 21,
    marginBottom: 20,
  },
  tipCard: {
    flexDirection: 'row',
    backgroundColor: COLORS.backgroundDark,
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
    gap: 12,
  },
  tipIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: COLORS.primary + '15',
    alignItems: 'center',
    justifyContent: 'center',
  },
  tipContent: {
    flex: 1,
  },
  tipTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: COLORS.text,
    marginBottom: 4,
  },
  tipDescription: {
    fontSize: 13,
    color: COLORS.textLight,
    lineHeight: 19,
  },
  divider: {
    height: 1,
    backgroundColor: COLORS.border,
    marginVertical: 24,
  },
  reasonsGrid: {
    gap: 8,
  },
  reasonItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 8,
    paddingHorizontal: 4,
  },
  reasonText: {
    fontSize: 14,
    color: COLORS.text,
  },
  processSteps: {
    gap: 12,
    marginBottom: 24,
  },
  stepRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  stepNumber: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: COLORS.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepNumberText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  stepText: {
    fontSize: 14,
    color: COLORS.text,
    lineHeight: 20,
    flex: 1,
    paddingTop: 3,
  },
  emergencyBox: {
    flexDirection: 'row',
    backgroundColor: COLORS.error + '10',
    borderWidth: 1,
    borderColor: COLORS.error + '30',
    borderRadius: 12,
    padding: 16,
    gap: 12,
    alignItems: 'flex-start',
  },
  emergencyContent: {
    flex: 1,
  },
  emergencyTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: COLORS.error,
    marginBottom: 4,
  },
  emergencyText: {
    fontSize: 13,
    color: COLORS.textLight,
    lineHeight: 19,
  },
});
