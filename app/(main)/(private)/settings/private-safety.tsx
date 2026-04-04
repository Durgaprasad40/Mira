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

  const safeMode = usePrivateProfileStore((s) => s.safeMode);
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
        {/* Safe Mode Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Protection</Text>

          {/* Safe Mode Toggle */}
          <View style={styles.safeModeCard}>
            <View style={styles.safeModeRow}>
              <View style={styles.safeModeInfo}>
                <View style={[styles.safeModeIcon, safeMode && styles.safeModeIconActive]}>
                  <Ionicons name="shield-checkmark" size={22} color={safeMode ? '#FFF' : C.text} />
                </View>
                <View style={styles.safeModeTextContainer}>
                  <Text style={styles.safeModeTitle}>Safe Mode</Text>
                  <Text style={styles.safeModeDescription}>
                    Filter harmful or suspicious messages automatically
                  </Text>
                </View>
              </View>
              <Switch
                value={safeMode}
                onValueChange={setSafeMode}
                trackColor={{ false: C.border, true: C.primary }}
                thumbColor="#FFF"
              />
            </View>
          </View>
        </View>

        {/* Trust & Safety */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Trust & Safety</Text>

          {/* Blocked Users */}
          <TouchableOpacity
            style={[styles.navRow, styles.navRowLast]}
            onPress={() => router.push('/(main)/(private)/settings/phase2-blocked-users')}
            activeOpacity={0.7}
          >
            <View style={styles.navRowLeft}>
              <Ionicons name="ban-outline" size={22} color={C.text} />
              <Text style={styles.navRowTitle}>Blocked Users</Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color={C.textLight} />
          </TouchableOpacity>
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
  // Safe Mode card styles
  safeModeCard: {
    backgroundColor: C.surface,
    borderRadius: 14,
    overflow: 'hidden',
    marginTop: 8,
  },
  safeModeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 14,
  },
  safeModeInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    marginRight: 12,
  },
  safeModeIcon: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: C.accent,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  safeModeIconActive: {
    backgroundColor: C.primary,
  },
  safeModeTextContainer: {
    flex: 1,
  },
  safeModeTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: C.text,
    marginBottom: 2,
  },
  safeModeDescription: {
    fontSize: 13,
    color: C.textLight,
    lineHeight: 17,
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
  navRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  navRowLast: {
    borderBottomWidth: 0,
  },
  navRowLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  navRowTitle: {
    fontSize: 16,
    fontWeight: '500',
    color: C.text,
  },
});
