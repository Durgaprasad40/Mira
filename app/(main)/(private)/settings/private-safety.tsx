import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Switch } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { INCOGNITO_COLORS } from '@/lib/constants';
import { usePrivateProfileStore } from '@/stores/privateProfileStore';

const C = INCOGNITO_COLORS;

// Safety tips for private mode
const SAFETY_TIPS = {
  privacy: {
    title: 'Protect Your Privacy',
    tips: [
      'Never share personal information like your address or workplace',
      'Use secure media timers for sensitive photos/videos',
      'Be cautious about what you reveal in conversations',
      'Report any suspicious behavior immediately',
    ],
  },
  meetSafely: {
    title: 'Meet Safely',
    tips: [
      'Always meet in a public place for first dates',
      'Tell a friend where you\'re going and who you\'re meeting',
      'Arrange your own transportation',
      'Trust your instincts—leave if something feels wrong',
    ],
  },
};

export default function SafetyScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const whoCanMessageMe = usePrivateProfileStore((s) => s.whoCanMessageMe);
  const safeMode = usePrivateProfileStore((s) => s.safeMode);

  const setWhoCanMessageMe = usePrivateProfileStore((s) => s.setWhoCanMessageMe);
  const setSafeMode = usePrivateProfileStore((s) => s.setSafeMode);

  const [expandedTip, setExpandedTip] = useState<string | null>(null);

  const toggleTip = (tipKey: string) => {
    setExpandedTip(expandedTip === tipKey ? null : tipKey);
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={24} color={C.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Safety</Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
        {/* Messaging Controls */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Messaging Controls</Text>

          {/* Who Can Message Me */}
          <View style={styles.settingSection}>
            <Text style={styles.settingLabel}>Who can message me</Text>
            <Text style={styles.settingDescription}>
              Control who can start conversations with you
            </Text>
            <View style={styles.segmentedControl}>
              <TouchableOpacity
                style={[styles.segment, whoCanMessageMe === 'everyone' && styles.segmentActive]}
                onPress={() => setWhoCanMessageMe('everyone')}
              >
                <Text style={[styles.segmentText, whoCanMessageMe === 'everyone' && styles.segmentTextActive]}>
                  Everyone
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.segment, whoCanMessageMe === 'matches' && styles.segmentActive]}
                onPress={() => setWhoCanMessageMe('matches')}
              >
                <Text style={[styles.segmentText, whoCanMessageMe === 'matches' && styles.segmentTextActive]}>
                  Matches
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.segment, whoCanMessageMe === 'verified' && styles.segmentActive]}
                onPress={() => setWhoCanMessageMe('verified')}
              >
                <Text style={[styles.segmentText, whoCanMessageMe === 'verified' && styles.segmentTextActive]}>
                  Verified
                </Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* Safe Mode */}
          <View style={styles.toggleRow}>
            <View style={styles.toggleInfo}>
              <Text style={styles.toggleTitle}>Safe Mode</Text>
              <Text style={styles.toggleDescription}>
                Enhanced filtering and protection from harmful content
              </Text>
            </View>
            <Switch
              value={safeMode}
              onValueChange={setSafeMode}
              trackColor={{ false: C.border, true: C.primary }}
              thumbColor="#FFF"
            />
          </View>
        </View>

        {/* Safety Tips */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Safety Tips</Text>
          <Text style={styles.sectionSubtitle}>Tips to stay safe in private mode</Text>

          {/* Protect Your Privacy */}
          <TouchableOpacity
            style={styles.tipRow}
            onPress={() => toggleTip('privacy')}
            activeOpacity={0.7}
          >
            <View style={styles.tipRowLeft}>
              <Ionicons name="shield-outline" size={22} color={C.text} />
              <Text style={styles.tipRowTitle}>{SAFETY_TIPS.privacy.title}</Text>
            </View>
            <Ionicons
              name={expandedTip === 'privacy' ? 'chevron-up' : 'chevron-down'}
              size={20}
              color={C.textLight}
            />
          </TouchableOpacity>
          {expandedTip === 'privacy' && (
            <View style={styles.tipContent}>
              {SAFETY_TIPS.privacy.tips.map((tip, index) => (
                <View key={index} style={styles.tipItem}>
                  <Text style={styles.tipBullet}>•</Text>
                  <Text style={styles.tipText}>{tip}</Text>
                </View>
              ))}
            </View>
          )}

          {/* Meet Safely */}
          <TouchableOpacity
            style={styles.tipRow}
            onPress={() => toggleTip('meetSafely')}
            activeOpacity={0.7}
          >
            <View style={styles.tipRowLeft}>
              <Ionicons name="people-outline" size={22} color={C.text} />
              <Text style={styles.tipRowTitle}>{SAFETY_TIPS.meetSafely.title}</Text>
            </View>
            <Ionicons
              name={expandedTip === 'meetSafely' ? 'chevron-up' : 'chevron-down'}
              size={20}
              color={C.textLight}
            />
          </TouchableOpacity>
          {expandedTip === 'meetSafely' && (
            <View style={styles.tipContent}>
              {SAFETY_TIPS.meetSafely.tips.map((tip, index) => (
                <View key={index} style={styles.tipItem}>
                  <Text style={styles.tipBullet}>•</Text>
                  <Text style={styles.tipText}>{tip}</Text>
                </View>
              ))}
            </View>
          )}
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
    borderBottomColor: C.border,
  },
  backBtn: {
    padding: 4,
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '600',
    color: C.text,
  },
  content: {
    flex: 1,
  },
  section: {
    paddingHorizontal: 16,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: C.textLight,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  sectionSubtitle: {
    fontSize: 13,
    color: C.textLight,
    marginBottom: 12,
  },
  settingSection: {
    marginBottom: 16,
  },
  settingLabel: {
    fontSize: 15,
    fontWeight: '600',
    color: C.text,
    marginBottom: 4,
  },
  settingDescription: {
    fontSize: 13,
    color: C.textLight,
    lineHeight: 18,
    marginBottom: 12,
  },
  segmentedControl: {
    flexDirection: 'row',
    backgroundColor: C.surface,
    borderRadius: 10,
    padding: 4,
  },
  segment: {
    flex: 1,
    paddingVertical: 8,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
  },
  segmentActive: {
    backgroundColor: C.primary,
  },
  segmentText: {
    fontSize: 14,
    fontWeight: '600',
    color: C.textLight,
  },
  segmentTextActive: {
    color: '#FFF',
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
  },
  toggleInfo: {
    flex: 1,
    marginRight: 16,
  },
  toggleTitle: {
    fontSize: 16,
    fontWeight: '500',
    color: C.text,
    marginBottom: 2,
  },
  toggleDescription: {
    fontSize: 13,
    color: C.textLight,
    lineHeight: 18,
  },
  tipRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  tipRowLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  tipRowTitle: {
    fontSize: 16,
    fontWeight: '500',
    color: C.text,
  },
  tipContent: {
    backgroundColor: C.surface,
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
    color: C.primary,
    marginRight: 8,
    marginTop: 1,
  },
  tipText: {
    flex: 1,
    fontSize: 14,
    color: C.text,
    lineHeight: 20,
  },
});
