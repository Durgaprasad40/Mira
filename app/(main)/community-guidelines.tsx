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

interface GuidelineSection {
  icon: string;
  title: string;
  items: string[];
}

const GUIDELINES: GuidelineSection[] = [
  {
    icon: 'heart',
    title: 'Be Respectful',
    items: [
      'Treat everyone with dignity and respect',
      'Consent is required for all interactions',
      'Respect boundaries when someone says no',
      'No harassment, bullying, or intimidation',
    ],
  },
  {
    icon: 'shield-checkmark',
    title: 'Keep It Safe',
    items: [
      'No sharing of explicit or inappropriate content',
      'No inappropriate imagery in profile photos or messages',
      'No non-consensual content or behavior',
      'Report any suspicious or concerning behavior',
    ],
  },
  {
    icon: 'ban',
    title: 'Strictly Prohibited',
    items: [
      'Solicitation of paid services or meetups',
      'Escorting or financial arrangements for meetups',
      'Content involving minors in any inappropriate context',
      'Non-consensual intimate images',
      'Threats of violence or physical harm',
      'Hate speech or discrimination',
    ],
  },
  {
    icon: 'person-circle',
    title: 'Be Authentic',
    items: [
      'Use real, recent photos of yourself',
      'Do not impersonate others or create fake profiles',
      'Be honest about your intentions',
      'No spam, scams, or commercial solicitation',
    ],
  },
  {
    icon: 'lock-closed',
    title: 'Private Mode Rules',
    items: [
      'Private Mode is for 18+ users only',
      'Designed for discreet, consensual connections',
      'All content moderation rules apply',
      'Boundaries-first approach is expected',
      'No explicit acts as room topics or prompts',
    ],
  },
  {
    icon: 'warning',
    title: 'Enforcement',
    items: [
      '1st violation: Warning',
      '2nd-3rd violations: Temporary restriction',
      '4th+ violations: Permanent ban',
      'Critical violations (underage, non-consensual): Immediate ban',
      'Violations may be reported to law enforcement when required',
    ],
  },
];

export default function CommunityGuidelinesScreen() {
  const router = useRouter();

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={24} color={COLORS.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Community Guidelines</Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={styles.intro}>
          Mira is built on respect, consent, and safety. These guidelines
          apply to all areas of the app including profiles, messages, chat rooms,
          Truth or Dare, and Private Mode.
        </Text>

        {GUIDELINES.map((section) => (
          <View key={section.title} style={styles.section}>
            <View style={styles.sectionHeader}>
              <Ionicons name={section.icon as any} size={22} color={COLORS.primary} />
              <Text style={styles.sectionTitle}>{section.title}</Text>
            </View>
            {section.items.map((item, i) => (
              <View key={i} style={styles.ruleRow}>
                <Text style={styles.bullet}>{'\u2022'}</Text>
                <Text style={styles.ruleText}>{item}</Text>
              </View>
            ))}
          </View>
        ))}

        <View style={styles.footer}>
          <Text style={styles.footerText}>
            Violations of these guidelines may result in content removal,
            account restriction, or permanent ban. If you see something that
            violates these guidelines, please use the Report button.
          </Text>
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
  intro: {
    fontSize: 15,
    color: COLORS.textLight,
    lineHeight: 22,
    marginBottom: 24,
  },
  section: {
    marginBottom: 24,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: COLORS.text,
  },
  ruleRow: {
    flexDirection: 'row',
    paddingLeft: 8,
    marginBottom: 8,
    gap: 8,
  },
  bullet: {
    fontSize: 14,
    color: COLORS.textLight,
    lineHeight: 20,
  },
  ruleText: {
    fontSize: 14,
    color: COLORS.text,
    lineHeight: 20,
    flex: 1,
  },
  footer: {
    backgroundColor: COLORS.backgroundDark,
    borderRadius: 12,
    padding: 16,
    marginTop: 8,
  },
  footerText: {
    fontSize: 13,
    color: COLORS.textLight,
    lineHeight: 20,
  },
});
