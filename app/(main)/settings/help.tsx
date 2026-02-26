import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '@/lib/constants';

// Help topics content
const HELP_TOPICS = {
  login: {
    title: 'Login / Signup Issues',
    icon: 'log-in-outline' as const,
    tips: [
      'Double-check your email or phone number for typos',
      'Make sure Caps Lock is off when entering your password',
      'Try "Forgot Password" to reset your credentials',
      'Check your spam folder for verification emails',
    ],
  },
  verification: {
    title: 'Verification Help',
    icon: 'shield-checkmark-outline' as const,
    tips: [
      'Use good lighting and face the camera directly',
      'Remove sunglasses, hats, or anything covering your face',
      'Make sure your photo matches your profile pictures',
      'Verification usually takes a few minutes to process',
    ],
  },
  reporting: {
    title: 'Reporting & Safety',
    icon: 'flag-outline' as const,
    tips: [
      'To report a user, tap the ••• menu on their profile',
      'You can block someone at any time from their profile',
      'Reports are reviewed within 24 hours',
      'Your identity is kept confidential when reporting',
    ],
  },
  bugs: {
    title: 'App Bugs / Crashes',
    icon: 'bug-outline' as const,
    tips: [
      'Try closing and reopening the app',
      'Check for app updates in your app store',
      'Restart your device if issues persist',
      'Clear app cache in your device settings',
    ],
  },
};

export default function HelpSupportScreen() {
  const router = useRouter();

  // Track which help topic is expanded
  const [expandedTopic, setExpandedTopic] = useState<string | null>(null);

  const toggleTopic = (topicKey: string) => {
    setExpandedTopic(expandedTopic === topicKey ? null : topicKey);
  };

  const handleChatSupport = () => {
    Alert.alert(
      'Support Chat',
      'Live chat support is coming soon. In the meantime, try our Quick Help section above!',
      [{ text: 'OK' }]
    );
  };

  const handleEmailSupport = () => {
    Alert.alert(
      'Email Support',
      'Email support is coming soon. You\'ll be able to reach us at support@mira.app',
      [{ text: 'OK' }]
    );
  };

  const handlePrivacyPolicy = () => {
    Alert.alert(
      'Privacy Policy',
      'Privacy Policy document is coming soon.',
      [{ text: 'OK' }]
    );
  };

  const handleTermsOfService = () => {
    Alert.alert(
      'Terms of Service',
      'Terms of Service document is coming soon.',
      [{ text: 'OK' }]
    );
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
          <Ionicons name="arrow-back" size={24} color={COLORS.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Help & Support</Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
        {/* Hero subtitle */}
        <View style={styles.heroSection}>
          <Ionicons name="help-buoy-outline" size={32} color={COLORS.primary} />
          <Text style={styles.heroText}>Get help fast — we're here for you.</Text>
        </View>

        {/* Quick Help Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Quick Help</Text>

          {/* Login / Signup */}
          <TouchableOpacity
            style={styles.topicRow}
            onPress={() => toggleTopic('login')}
            activeOpacity={0.7}
          >
            <View style={styles.topicRowLeft}>
              <Ionicons name={HELP_TOPICS.login.icon} size={22} color={COLORS.text} />
              <Text style={styles.topicRowTitle}>{HELP_TOPICS.login.title}</Text>
            </View>
            <Ionicons
              name={expandedTopic === 'login' ? 'chevron-up' : 'chevron-down'}
              size={20}
              color={COLORS.textLight}
            />
          </TouchableOpacity>
          {expandedTopic === 'login' && (
            <View style={styles.topicContent}>
              {HELP_TOPICS.login.tips.map((tip, index) => (
                <View key={index} style={styles.tipItem}>
                  <Text style={styles.tipBullet}>•</Text>
                  <Text style={styles.tipText}>{tip}</Text>
                </View>
              ))}
            </View>
          )}

          {/* Verification Help */}
          <TouchableOpacity
            style={styles.topicRow}
            onPress={() => toggleTopic('verification')}
            activeOpacity={0.7}
          >
            <View style={styles.topicRowLeft}>
              <Ionicons name={HELP_TOPICS.verification.icon} size={22} color={COLORS.text} />
              <Text style={styles.topicRowTitle}>{HELP_TOPICS.verification.title}</Text>
            </View>
            <Ionicons
              name={expandedTopic === 'verification' ? 'chevron-up' : 'chevron-down'}
              size={20}
              color={COLORS.textLight}
            />
          </TouchableOpacity>
          {expandedTopic === 'verification' && (
            <View style={styles.topicContent}>
              {HELP_TOPICS.verification.tips.map((tip, index) => (
                <View key={index} style={styles.tipItem}>
                  <Text style={styles.tipBullet}>•</Text>
                  <Text style={styles.tipText}>{tip}</Text>
                </View>
              ))}
            </View>
          )}

          {/* Reporting & Safety */}
          <TouchableOpacity
            style={styles.topicRow}
            onPress={() => toggleTopic('reporting')}
            activeOpacity={0.7}
          >
            <View style={styles.topicRowLeft}>
              <Ionicons name={HELP_TOPICS.reporting.icon} size={22} color={COLORS.text} />
              <Text style={styles.topicRowTitle}>{HELP_TOPICS.reporting.title}</Text>
            </View>
            <Ionicons
              name={expandedTopic === 'reporting' ? 'chevron-up' : 'chevron-down'}
              size={20}
              color={COLORS.textLight}
            />
          </TouchableOpacity>
          {expandedTopic === 'reporting' && (
            <View style={styles.topicContent}>
              {HELP_TOPICS.reporting.tips.map((tip, index) => (
                <View key={index} style={styles.tipItem}>
                  <Text style={styles.tipBullet}>•</Text>
                  <Text style={styles.tipText}>{tip}</Text>
                </View>
              ))}
            </View>
          )}

          {/* App Bugs / Crashes */}
          <TouchableOpacity
            style={[styles.topicRow, styles.topicRowLast]}
            onPress={() => toggleTopic('bugs')}
            activeOpacity={0.7}
          >
            <View style={styles.topicRowLeft}>
              <Ionicons name={HELP_TOPICS.bugs.icon} size={22} color={COLORS.text} />
              <Text style={styles.topicRowTitle}>{HELP_TOPICS.bugs.title}</Text>
            </View>
            <Ionicons
              name={expandedTopic === 'bugs' ? 'chevron-up' : 'chevron-down'}
              size={20}
              color={COLORS.textLight}
            />
          </TouchableOpacity>
          {expandedTopic === 'bugs' && (
            <View style={styles.topicContent}>
              {HELP_TOPICS.bugs.tips.map((tip, index) => (
                <View key={index} style={styles.tipItem}>
                  <Text style={styles.tipBullet}>•</Text>
                  <Text style={styles.tipText}>{tip}</Text>
                </View>
              ))}
            </View>
          )}
        </View>

        {/* Contact Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Contact Us</Text>

          <TouchableOpacity style={styles.contactButton} onPress={handleChatSupport} activeOpacity={0.8}>
            <Ionicons name="chatbubbles" size={20} color={COLORS.white} />
            <Text style={styles.contactButtonText}>Chat with Support</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.menuRow} onPress={handleEmailSupport} activeOpacity={0.7}>
            <View style={styles.menuRowLeft}>
              <Ionicons name="mail-outline" size={22} color={COLORS.text} />
              <View style={styles.menuRowInfo}>
                <Text style={styles.menuRowTitle}>Email us</Text>
                <Text style={styles.menuRowSubtitle}>support@mira.app</Text>
              </View>
            </View>
            <Ionicons name="chevron-forward" size={20} color={COLORS.textLight} />
          </TouchableOpacity>
        </View>

        {/* Legal Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Legal</Text>

          <TouchableOpacity style={styles.menuRow} onPress={handlePrivacyPolicy} activeOpacity={0.7}>
            <View style={styles.menuRowLeft}>
              <Ionicons name="lock-closed-outline" size={22} color={COLORS.text} />
              <Text style={styles.menuRowTitle}>Privacy Policy</Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color={COLORS.textLight} />
          </TouchableOpacity>

          <TouchableOpacity style={styles.menuRow} onPress={handleTermsOfService} activeOpacity={0.7}>
            <View style={styles.menuRowLeft}>
              <Ionicons name="document-text-outline" size={22} color={COLORS.text} />
              <Text style={styles.menuRowTitle}>Terms of Service</Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color={COLORS.textLight} />
          </TouchableOpacity>
        </View>

        {/* App Version */}
        <View style={styles.versionSection}>
          <Text style={styles.versionText}>Mira v1.0.0</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
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
    fontWeight: '600',
    color: COLORS.text,
  },
  content: {
    flex: 1,
  },
  // Hero section
  heroSection: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 20,
    backgroundColor: COLORS.backgroundDark,
  },
  heroText: {
    flex: 1,
    fontSize: 16,
    fontWeight: '500',
    color: COLORS.text,
  },
  section: {
    paddingHorizontal: 16,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 12,
  },
  // Expandable topic rows
  topicRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  topicRowLast: {
    borderBottomWidth: 0,
  },
  topicRowLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  topicRowTitle: {
    fontSize: 16,
    fontWeight: '500',
    color: COLORS.text,
  },
  topicContent: {
    backgroundColor: COLORS.backgroundDark,
    borderRadius: 8,
    padding: 14,
    marginBottom: 8,
  },
  tipItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 8,
  },
  tipBullet: {
    fontSize: 14,
    color: COLORS.primary,
    marginRight: 8,
    marginTop: 1,
  },
  tipText: {
    flex: 1,
    fontSize: 14,
    color: COLORS.text,
    lineHeight: 20,
  },
  // Contact button
  contactButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    backgroundColor: COLORS.primary,
    paddingVertical: 14,
    borderRadius: 10,
    marginBottom: 12,
  },
  contactButtonText: {
    fontSize: 15,
    fontWeight: '600',
    color: COLORS.white,
  },
  // Menu rows
  menuRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
  },
  menuRowLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    gap: 14,
  },
  menuRowInfo: {
    flex: 1,
  },
  menuRowTitle: {
    fontSize: 16,
    fontWeight: '500',
    color: COLORS.text,
  },
  menuRowSubtitle: {
    fontSize: 13,
    color: COLORS.textMuted,
    marginTop: 2,
  },
  // Version section
  versionSection: {
    paddingVertical: 24,
    alignItems: 'center',
  },
  versionText: {
    fontSize: 13,
    color: COLORS.textMuted,
  },
});
