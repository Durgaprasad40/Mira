/**
 * Phase 2 Onboarding - Edit Looking For (Intents)
 *
 * Dedicated screen for editing the "Looking For" intents in Phase-2.
 * Reuses the same intent categories and logic from photo-select.
 * Saves to privateProfileStore and navigates back to Step-3.
 */
import React, { useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { INCOGNITO_COLORS } from '@/lib/constants';
import { PRIVATE_INTENT_CATEGORIES } from '@/lib/privateConstants';
import {
  usePrivateProfileStore,
  PHASE2_MIN_INTENTS,
  PHASE2_MAX_INTENTS,
} from '@/stores/privateProfileStore';

const C = INCOGNITO_COLORS;

export default function LookingForEdit() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  // P2-005 FIX: Ref guard to prevent multiple back() calls
  const didSaveRef = useRef(false);

  // Store state
  const intentKeys = usePrivateProfileStore((s) => s.intentKeys);
  const setIntentKeys = usePrivateProfileStore((s) => s.setIntentKeys);

  // Validation
  const canSave = intentKeys.length >= PHASE2_MIN_INTENTS && intentKeys.length <= PHASE2_MAX_INTENTS;

  // Toggle intent selection
  const toggleIntent = useCallback((key: string) => {
    const current = usePrivateProfileStore.getState().intentKeys;
    if (current.includes(key as any)) {
      setIntentKeys(current.filter((k) => k !== key) as any);
    } else if (current.length < PHASE2_MAX_INTENTS) {
      setIntentKeys([...current, key] as any);
    }
  }, [setIntentKeys]);

  // Save and go back
  const handleSave = useCallback(() => {
    if (!canSave) return;
    // P2-005 FIX: Ref guard prevents multiple back() calls on rapid taps
    if (didSaveRef.current) return;
    didSaveRef.current = true;
    router.back();
  }, [canSave, router]);

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => router.back()}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Ionicons name="arrow-back" size={24} color={C.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Edit Looking For</Text>
        <TouchableOpacity
          onPress={handleSave}
          disabled={!canSave}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Text style={[styles.saveBtn, !canSave && styles.saveBtnDisabled]}>Save</Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        {/* Instructions */}
        <View style={styles.instructionBox}>
          <Text style={styles.instructionTitle}>What are you looking for?</Text>
          <Text style={styles.instructionText}>
            Select {PHASE2_MIN_INTENTS}-{PHASE2_MAX_INTENTS} intents that describe what you're seeking.
          </Text>
        </View>

        {/* Counter */}
        <View style={styles.counterRow}>
          <Text style={styles.counterLabel}>Selected</Text>
          <Text style={[styles.counterValue, canSave && styles.counterValueValid]}>
            {intentKeys.length}/{PHASE2_MAX_INTENTS}
          </Text>
        </View>

        {/* Intent Grid */}
        <View style={styles.intentGrid}>
          {PRIVATE_INTENT_CATEGORIES.map((cat) => {
            const selected = intentKeys.includes(cat.key as any);
            return (
              <TouchableOpacity
                key={cat.key}
                style={[styles.intentChip, selected && styles.intentChipSelected]}
                onPress={() => toggleIntent(cat.key)}
              >
                <Ionicons name={cat.icon as any} size={18} color={selected ? C.primary : C.textLight} />
                <Text style={[styles.intentText, selected && styles.intentTextSelected]}>
                  {cat.label}
                </Text>
                {selected && <Ionicons name="checkmark" size={16} color={C.primary} />}
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Bottom spacing */}
        <View style={{ height: 100 }} />
      </ScrollView>

      {/* Bottom Save Button */}
      <View style={[styles.bottomBar, { paddingBottom: Math.max(insets.bottom, 16) + 12 }]}>
        {!canSave && (
          <Text style={styles.bottomHint}>
            {intentKeys.length === 0
              ? `Select at least ${PHASE2_MIN_INTENTS} intent`
              : intentKeys.length < PHASE2_MIN_INTENTS
              ? `Select ${PHASE2_MIN_INTENTS - intentKeys.length} more`
              : `Maximum ${PHASE2_MAX_INTENTS} intents allowed`}
          </Text>
        )}
        <TouchableOpacity
          style={[styles.saveButton, !canSave && styles.saveButtonDisabled]}
          onPress={handleSave}
          disabled={!canSave}
        >
          <Text style={[styles.saveButtonText, !canSave && styles.saveButtonTextDisabled]}>
            Save Changes
          </Text>
          <Ionicons name="checkmark-circle" size={20} color={canSave ? '#FFF' : C.textLight} />
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: C.surface,
  },
  headerTitle: { fontSize: 18, fontWeight: '700', color: C.text },
  saveBtn: {
    fontSize: 16,
    fontWeight: '600',
    color: C.primary,
  },
  saveBtnDisabled: {
    color: C.textLight,
  },
  content: { padding: 16, paddingBottom: 40 },

  // Instruction box
  instructionBox: {
    backgroundColor: C.surface,
    borderRadius: 12,
    padding: 16,
    marginBottom: 20,
  },
  instructionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: C.text,
    marginBottom: 6,
  },
  instructionText: {
    fontSize: 13,
    color: C.textLight,
    lineHeight: 18,
  },

  // Counter
  counterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  counterLabel: {
    fontSize: 14,
    color: C.textLight,
  },
  counterValue: {
    fontSize: 14,
    fontWeight: '600',
    color: C.textLight,
    backgroundColor: C.surface,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 10,
  },
  counterValueValid: {
    color: '#4CAF50',
    backgroundColor: 'rgba(76,175,80,0.15)',
  },

  // Intent grid
  intentGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  intentChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 20,
    backgroundColor: '#2A2A2A',
    borderWidth: 1.5,
    borderColor: '#3A3A3A',
  },
  intentChipSelected: {
    backgroundColor: C.primary + '18',
    borderColor: C.primary,
  },
  intentText: {
    fontSize: 13,
    color: '#CCC',
    fontWeight: '500',
  },
  intentTextSelected: {
    color: C.primary,
    fontWeight: '600',
  },

  // Bottom bar
  bottomBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 16,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: C.surface,
    backgroundColor: C.background,
  },
  bottomHint: {
    fontSize: 12,
    color: C.primary,
    textAlign: 'center',
    marginBottom: 10,
  },
  saveButton: {
    flexDirection: 'row',
    backgroundColor: C.primary,
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  saveButtonDisabled: {
    backgroundColor: C.surface,
  },
  saveButtonText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#FFF',
  },
  saveButtonTextDisabled: {
    color: C.textLight,
  },
});
