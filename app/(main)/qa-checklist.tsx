import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Platform,
  Switch,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '@/lib/constants';
import { isDemoMode } from '@/hooks/useConvex';
import Constants from 'expo-constants';

// ---------------------------------------------------------------------------
// Launch Blocker Checklist Items
// ---------------------------------------------------------------------------

const CHECKLIST_ITEMS = [
  { id: 'discover_swipe', label: 'Discover swipe works (no stuck)' },
  { id: 'like_back_match', label: 'Like-back creates match + thread appears' },
  { id: 'chat_back_nav', label: 'Back navigation from chat returns to Messages list' },
  { id: 'confession_create', label: 'Confession create works + appears' },
  { id: 'tagged_badge', label: 'Tagged confession badge increments' },
  { id: 'tagged_like_unlock', label: 'Tagged user likes → chat unlocks' },
  { id: 'confession_chat_expires', label: 'Confession chat expires after 24h (manual simulate)' },
  { id: 'nearby_permission', label: 'Nearby permission OFF shows enable UI' },
  { id: 'nearby_centers', label: 'Nearby centers to real location' },
  { id: 'pins_shift_zoom', label: 'Pins shift on zoom (anti-triangulation)' },
  { id: 'hide_distance_fuzz', label: 'hideDistance shows larger fuzz' },
  { id: 'crossed_alert_once', label: 'Crossed alert triggers once (no spam)' },
  { id: 'report_confession', label: 'Report confession works (report-only)' },
  { id: 'block_removes_user', label: 'Block/report removes user from all areas' },
];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function QAChecklistScreen() {
  const router = useRouter();

  // Checklist state (local only, no persistence)
  const [checkedItems, setCheckedItems] = useState<Record<string, boolean>>({});

  // Toggle a checklist item
  const toggleItem = (id: string) => {
    setCheckedItems((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  // Reset all toggles
  const handleReset = () => {
    setCheckedItems({});
  };

  // Count checked items
  const checkedCount = Object.values(checkedItems).filter(Boolean).length;
  const totalCount = CHECKLIST_ITEMS.length;

  // Build info
  const appVersion = Constants.expoConfig?.version ?? 'unknown';

  // Gate: only show in demo or __DEV__
  if (!isDemoMode && !__DEV__) {
    return (
      <View style={styles.blockedContainer}>
        <Ionicons name="lock-closed" size={48} color={COLORS.textMuted} />
        <Text style={styles.blockedText}>QA Checklist is only available in demo/dev mode</Text>
        <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
          <Text style={styles.backButtonText}>Go Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
          <Ionicons name="arrow-back" size={24} color={COLORS.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>QA Checklist</Text>
        <View style={{ width: 24 }} />
      </View>

      {/* Build Info */}
      <View style={styles.buildInfoSection}>
        <Text style={styles.buildInfoTitle}>Build Info</Text>
        <View style={styles.buildInfoRow}>
          <Text style={styles.buildInfoLabel}>isDemoMode:</Text>
          <Text style={[styles.buildInfoValue, isDemoMode && styles.buildInfoValueTrue]}>
            {isDemoMode ? 'true' : 'false'}
          </Text>
        </View>
        <View style={styles.buildInfoRow}>
          <Text style={styles.buildInfoLabel}>__DEV__:</Text>
          <Text style={[styles.buildInfoValue, __DEV__ && styles.buildInfoValueTrue]}>
            {__DEV__ ? 'true' : 'false'}
          </Text>
        </View>
        <View style={styles.buildInfoRow}>
          <Text style={styles.buildInfoLabel}>App Version:</Text>
          <Text style={styles.buildInfoValue}>{appVersion}</Text>
        </View>
      </View>

      {/* Quick Navigate */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Quick Navigate</Text>
        <View style={styles.navButtonsGrid}>
          <TouchableOpacity
            style={styles.navButton}
            onPress={() => router.push('/(main)/(tabs)/home' as any)}
          >
            <Ionicons name="heart" size={20} color={COLORS.white} />
            <Text style={styles.navButtonText}>Discover</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.navButton}
            onPress={() => router.push('/(main)/(tabs)/confessions' as any)}
          >
            <Ionicons name="megaphone" size={20} color={COLORS.white} />
            <Text style={styles.navButtonText}>Confessions</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.navButton}
            onPress={() => router.push('/(main)/(tabs)/messages' as any)}
          >
            <Ionicons name="chatbubbles" size={20} color={COLORS.white} />
            <Text style={styles.navButtonText}>Messages</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.navButton}
            onPress={() => router.push('/(main)/(tabs)/nearby' as any)}
          >
            <Ionicons name="location" size={20} color={COLORS.white} />
            <Text style={styles.navButtonText}>Nearby</Text>
          </TouchableOpacity>
        </View>

        {/* Tagged Modal Button */}
        <TouchableOpacity
          style={styles.taggedModalButton}
          onPress={() => {
            // Navigate to confessions and use a query param to auto-open tagged modal
            router.push('/(main)/(tabs)/confessions?openTagged=true' as any);
          }}
        >
          <Ionicons name="heart" size={18} color={COLORS.primary} />
          <Text style={styles.taggedModalButtonText}>Open "Tagged for you" Modal</Text>
          <Ionicons name="chevron-forward" size={18} color={COLORS.primary} />
        </TouchableOpacity>

        {/* Debug Event Log Button */}
        <TouchableOpacity
          style={styles.debugLogButton}
          onPress={() => router.push('/(main)/qa-debug-log' as any)}
        >
          <Ionicons name="list-outline" size={18} color="#3B82F6" />
          <Text style={styles.debugLogButtonText}>Open Debug Event Log</Text>
          <Ionicons name="chevron-forward" size={18} color="#3B82F6" />
        </TouchableOpacity>
      </View>

      {/* Launch Blockers Checklist */}
      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Launch Blockers</Text>
          <Text style={styles.progressText}>
            {checkedCount}/{totalCount} checked
          </Text>
        </View>

        {CHECKLIST_ITEMS.map((item) => (
          <View key={item.id} style={styles.checklistItem}>
            <Switch
              value={checkedItems[item.id] ?? false}
              onValueChange={() => toggleItem(item.id)}
              trackColor={{ false: COLORS.border, true: '#34C759' }}
              thumbColor={COLORS.white}
            />
            <Text
              style={[
                styles.checklistLabel,
                checkedItems[item.id] && styles.checklistLabelChecked,
              ]}
            >
              {item.label}
            </Text>
          </View>
        ))}

        {/* Reset Button */}
        <TouchableOpacity style={styles.resetButton} onPress={handleReset}>
          <Ionicons name="refresh" size={18} color={COLORS.error} />
          <Text style={styles.resetButtonText}>Reset All Toggles</Text>
        </TouchableOpacity>
      </View>

      {/* Bottom padding */}
      <View style={{ height: 40 }} />
    </ScrollView>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  blockedContainer: {
    flex: 1,
    backgroundColor: COLORS.background,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    gap: 16,
  },
  blockedText: {
    fontSize: 16,
    color: COLORS.textMuted,
    textAlign: 'center',
  },
  backButton: {
    marginTop: 8,
    paddingHorizontal: 24,
    paddingVertical: 12,
    backgroundColor: COLORS.primary,
    borderRadius: 24,
  },
  backButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.white,
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
    fontWeight: '700',
    color: COLORS.text,
  },
  buildInfoSection: {
    padding: 16,
    backgroundColor: COLORS.backgroundDark,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  buildInfoTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.textMuted,
    marginBottom: 8,
  },
  buildInfoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 4,
  },
  buildInfoLabel: {
    fontSize: 13,
    color: COLORS.textMuted,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  buildInfoValue: {
    fontSize: 13,
    color: COLORS.text,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontWeight: '600',
  },
  buildInfoValueTrue: {
    color: '#34C759',
  },
  section: {
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.text,
    marginBottom: 12,
  },
  progressText: {
    fontSize: 13,
    color: COLORS.textMuted,
    fontWeight: '500',
  },
  navButtonsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginBottom: 12,
  },
  navButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: COLORS.primary,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 20,
  },
  navButtonText: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.white,
  },
  taggedModalButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(255,107,107,0.1)',
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,107,107,0.2)',
  },
  taggedModalButtonText: {
    flex: 1,
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.primary,
  },
  debugLogButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(59,130,246,0.1)',
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(59,130,246,0.2)',
    marginTop: 10,
  },
  debugLogButtonText: {
    flex: 1,
    fontSize: 14,
    fontWeight: '600',
    color: '#3B82F6',
  },
  checklistItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.border,
  },
  checklistLabel: {
    flex: 1,
    fontSize: 14,
    color: COLORS.text,
    lineHeight: 20,
  },
  checklistLabelChecked: {
    color: COLORS.textMuted,
    textDecorationLine: 'line-through',
  },
  resetButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 16,
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: 'rgba(255,59,48,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255,59,48,0.15)',
  },
  resetButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.error,
  },
});
