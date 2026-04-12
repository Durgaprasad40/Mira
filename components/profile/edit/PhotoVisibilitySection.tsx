/**
 * PhotoVisibilitySection Component
 *
 * Extracted from edit-profile.tsx for maintainability.
 * Handles the blur toggle for photo visibility.
 *
 * NO LOGIC CHANGES - Structure refactor only.
 */
import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  Switch,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '@/lib/constants';

interface PhotoVisibilitySectionProps {
  blurEnabled: boolean;
  onToggleBlur: (value: boolean) => void;
}

export function PhotoVisibilitySection({
  blurEnabled,
  onToggleBlur,
}: PhotoVisibilitySectionProps) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>Photo Visibility</Text>
      <View style={styles.blurRow}>
        <View style={styles.blurInfo}>
          <View style={styles.blurLabelRow}>
            <Ionicons name="eye-off-outline" size={18} color={COLORS.primary} />
            <Text style={styles.blurLabel}>Enable Photo Blur</Text>
          </View>
          <Text style={styles.blurDescription}>
            {blurEnabled
              ? 'Tap the eye icon on each photo to blur/unblur it individually.'
              : 'Turn on to choose which photos to blur for privacy.'}
          </Text>
        </View>
        <Switch
          value={blurEnabled}
          onValueChange={onToggleBlur}
          trackColor={{ false: COLORS.border, true: COLORS.primary }}
          thumbColor={COLORS.white}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { padding: 16, borderBottomWidth: 1, borderBottomColor: COLORS.border },
  sectionTitle: { fontSize: 18, fontWeight: '600', color: COLORS.text, marginBottom: 8 },
  blurRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  blurInfo: { flex: 1, marginRight: 16 },
  blurLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 },
  blurLabel: { fontSize: 16, fontWeight: '600', color: COLORS.text },
  blurDescription: { fontSize: 12, color: COLORS.textLight, lineHeight: 16 },
});
